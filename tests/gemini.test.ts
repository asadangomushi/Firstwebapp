import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { simpleSchema } from '../src/lib/gemini';

describe('Geminiに渡す道具の入力の形', () => {
  it('細かい検査の指定は省き、型・説明・必須・選択肢だけを残す', () => {
    const schema = z.object({
      title: z.string().min(1),
      start: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe('開始'),
      kind: z.enum(['normal', 'exam']).optional(),
      steps: z.array(z.object({ title: z.string().min(1) })).min(1),
    });
    expect(simpleSchema(z.toJSONSchema(schema))).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: '開始' },
        kind: { type: 'string', enum: ['normal', 'exam'] },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      },
      required: ['title', 'start', 'steps'],
    });
  });

  it('項目の名前が指定の語と同じでも消さない', () => {
    // 「type」や「items」という名前の項目も、中身として残す
    const schema = z.object({ type: z.string(), pattern: z.string().optional() });
    expect(simpleSchema(z.toJSONSchema(schema))).toEqual({
      type: 'object',
      properties: { type: { type: 'string' }, pattern: { type: 'string' } },
      required: ['type'],
    });
  });
});
