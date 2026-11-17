// Gemini（Google）の呼び出し。
// ブラウザからGoogleのAPIを直接呼び、Geminiが選んだ道具をこの端末で実行する。
// APIキーはこの端末の設定にだけ保存される。
import { ApiError, FinishReason, GoogleGenAI, type Content, type Part } from '@google/genai';
import { z } from 'zod';
import {
  ERROR_PREFIX,
  SYSTEM,
  Stopped,
  dynamicSystem,
  nowLine,
  resetHooks,
  runTool,
  type AssistantTool,
  type ProviderRun,
} from './assistant';
import { getSettings } from './settings';

/** これまでのやり取り（次の発言のときに一緒に送る） */
let history: Content[] = [];
resetHooks.add(() => {
  history = [];
});

/**
 * Gemini側の一時的なエラー（混雑など）や、通信の途切れのときは、少し待って自動でやり直す。
 * 回数の上限（429）はやり直しても回復しないことが多いので、やり直さずにすぐ伝える。
 * やり直しはSDKに任せず自分で行い、「やり直しています」と画面に出す（待っている理由が分かるように）。
 */
const MAX_ATTEMPTS = 3;
const RETRY_STATUS = new Set([500, 502, 503, 504]);
/** 1回目のやり直しまでの待ち時間（ミリ秒）。2回目はその倍。 */
const RETRY_DELAY = 2000;

/** ブラウザが通信そのものに失敗したときのエラー（Chromeでは「Failed to fetch」） */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network/i.test(err.message);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('中止しました', 'AbortError'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new DOMException('中止しました', 'AbortError'));
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

function client(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

/** Googleが返したエラーの説明文を取り出す（調べやすいよう、そのまま利用者にも見せる） */
function detail(err: ApiError): string {
  try {
    const body = JSON.parse(err.message) as { error?: { message?: string; status?: string } };
    const msg = body.error?.message ?? '';
    const status = body.error?.status ?? '';
    return [status, msg].filter(Boolean).join('：') || err.message;
  } catch {
    return err.message;
  }
}

/** 道具を使って返事を出すまでの、やり取りの回数の上限（止まらなくなるのを防ぐ） */
const MAX_TURNS = 16;

/** Geminiに渡す道具の説明に残す項目。形の細かい検査は、こちらでZodが行う。 */
const KEEP = new Set(['type', 'description', 'properties', 'required', 'items', 'enum']);

/**
 * 道具の入力の形を、Geminiが確実に受け付ける素朴なJSON Schemaにする。
 * （正規表現や文字数の指定などは省く。受け付けない書き方が混ざると呼び出し全体が失敗するため）
 */
export function simpleSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simpleSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!KEEP.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      // properties の中身は「項目名 → 形」なので、項目名は消さずに中だけ整える
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, simpleSchema(v)]),
      );
    } else if (key === 'items') {
      out[key] = simpleSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function declaration(t: AssistantTool) {
  return {
    name: t.name,
    description: t.description,
    parametersJsonSchema: simpleSchema(z.toJSONSchema(t.schema)),
  };
}

/** 道具の結果を、Geminiに返す形にする */
function toResponse(result: string): Record<string, unknown> {
  if (result.startsWith(ERROR_PREFIX)) return { error: result.slice(ERROR_PREFIX.length) };
  try {
    return { output: JSON.parse(result) as unknown };
  } catch {
    return { output: result };
  }
}

const BLOCKED: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

export function describe(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400 && /api key/i.test(err.message)) {
      return 'APIキーが正しくないようです。設定の「AIアシスタント」でキーを確認してください。';
    }
    if (err.status === 401 || err.status === 403) {
      return 'このAPIキーでは使えませんでした。設定の「AIアシスタント」でキーを確認してください。';
    }
    if (err.status === 404) {
      return '選んだモデルが見つかりません。設定の「AIアシスタント」で「モデルの一覧を取得」を押して選び直してください。';
    }
    if (err.status === 429) {
      return '使える回数の上限に達しました。少し待ってからもう一度送ってください（無料の枠には1分・1日あたりの上限があります）。';
    }
    if (err.status >= 500) {
      return [
        `Gemini側で一時的なエラーが起きました（${err.status}）。自動で${MAX_ATTEMPTS}回試しましたが、うまくいきませんでした。`,
        '少し待ってからもう一度送るか、設定の「AIアシスタント」で別のモデル（名前に flash-lite が付くものなど）を選んでみてください。',
        `詳しい内容：${detail(err)}`,
      ].join('\n');
    }
    return `Geminiからエラーが返りました（${err.status}）：${detail(err)}`;
  }
  if (isNetworkError(err)) {
    return [
      `Geminiとの通信が途中で切れました。自動で${MAX_ATTEMPTS}回試しましたが、つながりませんでした。`,
      '電波の良いところで、返事が来るまで手帳アプリを開いたまま待ってみてください。',
      `詳しい内容：${String(err)}`,
    ].join('\n');
  }
  // 思いがけないエラーは、原因を調べられるよう中身をそのまま見せる
  return `うまく処理できませんでした。\n詳しい内容：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`;
}

export async function run(r: ProviderRun): Promise<void> {
  const settings = getSettings();

  /** 1回分の呼び出しを、一時的なエラーなら待ってやり直す */
  const generate = async <T>(call: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await call();
        r.onStatus('');
        return res;
      } catch (err) {
        const retryable =
          (err instanceof ApiError && RETRY_STATUS.has(err.status)) || isNetworkError(err);
        if (!retryable || attempt >= MAX_ATTEMPTS || r.signal.aborted) throw err;
        r.onStatus(
          isNetworkError(err)
            ? `通信が途切れたので、やり直しています（${attempt + 1}/${MAX_ATTEMPTS}回目）…`
            : `Geminiが混み合っているので、やり直しています（${attempt + 1}/${MAX_ATTEMPTS}回目）…`,
        );
        await wait(RETRY_DELAY * 2 ** (attempt - 1), r.signal);
      }
    }
  };

  // 個人の端末で自分のキーを使う前提なので、ブラウザから直接呼ぶ
  const ai = client(settings.geminiApiKey);

  const contents: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: r.body }, { text: nowLine(r.viewing) }] },
  ];
  const config = {
    systemInstruction: `${SYSTEM}\n\n${await dynamicSystem()}`,
    tools: [{ functionDeclarations: r.tools.map(declaration) }],
    abortSignal: r.signal,
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await generate(() =>
      ai.models.generateContent({ model: settings.geminiModel, contents, config }),
    );

    if (res.promptFeedback?.blockReason) {
      throw new Stopped('この内容にはお答えできませんでした。言い方を変えて試してみてください。');
    }
    const candidate = res.candidates?.[0];
    const content = candidate?.content;
    const parts = content?.parts ?? [];
    const reason = candidate?.finishReason;

    // 考えている途中の文（thought）は見せず、返事の文章だけを出す
    const text = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('');
    if (text) r.onText(text);

    if (reason && BLOCKED.has(reason)) {
      throw new Stopped('この内容にはお答えできませんでした。言い方を変えて試してみてください。');
    }
    const calls = parts.filter((p) => p.functionCall);
    if (reason === FinishReason.MAX_TOKENS && calls.length > 0) {
      // 途中で切れた入力では道具を実行しない
      throw new Stopped(
        '返事が長くなりすぎて途中で切れました。もう少し小さく分けて頼んでみてください。',
      );
    }
    if (!content || parts.length === 0) {
      if (reason === FinishReason.MALFORMED_FUNCTION_CALL) {
        throw new Stopped(
          'うまく処理できませんでした。もう一度、言い方を変えて頼んでみてください。',
        );
      }
      break;
    }

    // Geminiの返事は、受け取ったままの形で履歴に戻す
    // （中に入っている「思考の署名」を欠かすと、次の呼び出しが失敗するため）
    contents.push(content);
    if (calls.length === 0) break;

    r.onToolsUsed();
    const results: Part[] = [];
    for (const part of calls) {
      const call = part.functionCall!;
      const tool = r.tools.find((t) => t.name === call.name);
      const result = tool
        ? await runTool(tool, call.args ?? {})
        : `${ERROR_PREFIX}「${call.name}」という道具はありません。`;
      results.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: call.name,
          response: toResponse(result),
        },
      });
    }
    contents.push({ role: 'user', parts: results });
  }

  // 次の発言のために会話を覚えておく
  history = contents;
}

/** このAPIキーで使える、文章用のGeminiモデルの一覧（設定画面の選択肢に使う） */
export async function listModels(apiKey: string): Promise<string[]> {
  const ai = client(apiKey);
  const names: string[] = [];
  const pager = await ai.models.list({ config: { pageSize: 200 } });
  for await (const m of pager) {
    const name = (m.name ?? '').replace(/^models\//, '');
    if (!name.startsWith('gemini')) continue;
    if (!m.supportedActions?.includes('generateContent')) continue;
    // 画像・音声専用のモデルは、予定の操作には使えないので外す
    if (/image|tts|audio|live|embedding|robotics|computer-use/.test(name)) continue;
    names.push(name);
  }
  return names.sort().reverse();
}
