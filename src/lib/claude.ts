// Claude（Anthropic）の呼び出し。
// ブラウザからAnthropicのAPIを直接呼び、Claudeが選んだ道具をこの端末で実行する。
// APIキーはこの端末の設定にだけ保存される。
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { SYSTEM, Stopped, dynamicSystem, nowLine, resetHooks, type ProviderRun } from './assistant';
import { getSettings } from './settings';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** サーバー側のフォールバック（安全判定で断られたとき別のモデルで続ける機能）に対応するモデル */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** これまでのやり取り（次の発言のときに一緒に送る） */
let history: MessageParam[] = [];
resetHooks.add(() => {
  history = [];
});

export function describe(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'APIキーが正しくないようです。設定の「Claude」でキーを確認してください。';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'このAPIキーでは、選んだモデルを使う権限がありません。設定でモデルを変えてみてください。';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'いま混み合っています。少し待ってからもう一度送ってください。';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Claudeにつながりませんでした。ネットワークを確認してください。';
  }
  if (err instanceof Anthropic.APIError) {
    return `Claudeからエラーが返りました（${err.status ?? '不明'}）：${err.message}`;
  }
  return err instanceof Error ? err.message : '送信に失敗しました。';
}

export async function run(r: ProviderRun): Promise<void> {
  const settings = getSettings();
  // 個人の端末で自分のキーを使う前提なので、ブラウザから直接呼ぶ
  const client = new Anthropic({ apiKey: settings.claudeApiKey, dangerouslyAllowBrowser: true });

  // ストリーミング中も道具の入力を逐次受け取る（入力はZodで検証してから実行される）
  const tools = r.tools.map((t) =>
    betaZodTool({
      name: t.name,
      description: t.description,
      inputSchema: t.schema,
      run: t.run,
      eager_input_streaming: true,
    }),
  );
  const messages: MessageParam[] = [
    ...history,
    {
      role: 'user',
      content: [
        { type: 'text', text: r.body },
        { type: 'text', text: nowLine(r.viewing) },
      ],
    },
  ];

  const model = settings.claudeModel;
  const once = async (withFallback: boolean): Promise<void> => {
    let runner = client.beta.messages.toolRunner(
      {
        model,
        max_tokens: 64000,
        stream: true,
        max_iterations: 16,
        // 会話は短いので、サーバー側に会話を預ける機能（スレッド）は使わず、毎回こちらから全文を送る
        thread: false,
        // 予定の読み書きが中心なので、考える深さは中くらいにする
        output_config: { effort: 'medium' },
        // 会話が長くなっても、前のやり取りはキャッシュから読ませる
        cache_control: { type: 'ephemeral' },
        system: [
          { type: 'text', text: SYSTEM },
          { type: 'text', text: await dynamicSystem() },
        ],
        tools,
        messages,
        ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      },
      { signal: r.signal },
    );

    let final: Anthropic.Beta.Messages.BetaMessage | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const stream of runner) {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              r.onText(event.delta.text);
            }
          }
          const message = await stream.finalMessage();
          final = message;
          attempt = 0;
          const hasToolUse = message.content.some((b) => b.type === 'tool_use');
          // 途中で切れた入力や、断られた回のツールは実行しない
          if (message.stop_reason === 'max_tokens' && hasToolUse) {
            throw new Stopped(
              '返事が長くなりすぎて途中で切れました。もう少し小さく分けて頼んでみてください。',
            );
          }
          if (message.stop_reason === 'refusal') {
            throw new Stopped(
              'この内容にはお答えできませんでした。言い方を変えて試してみてください。',
            );
          }
          // 次の文章との間に区切りを入れる（ツールを使ったあとに続きを話すとき）
          if (hasToolUse) r.onToolsUsed();
        }
        break;
      } catch (err) {
        if (err instanceof Anthropic.APIError || err instanceof Stopped || attempt >= 2) throw err;
        if (r.signal.aborted) throw err;
        // ツールの入力が壊れて届いたときだけ、同じ回をやり直す
        runner = client.beta.messages.toolRunner({ ...runner.params }, { signal: r.signal });
      }
    }

    // 次の発言のために会話を覚えておく
    const next = [...runner.params.messages];
    if (final && next[next.length - 1]?.role !== 'assistant') {
      next.push({ role: 'assistant', content: final.content });
    }
    history = next;
  };

  const fallback = FALLBACK_MODELS.has(model);
  try {
    await once(fallback);
  } catch (err) {
    // フォールバックの指定を受け付けない環境では、指定なしでもう一度だけ試す
    if (fallback && r.isEmpty() && err instanceof Anthropic.BadRequestError) await once(false);
    else throw err;
  }
}
