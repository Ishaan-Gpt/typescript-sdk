/**
 * Regression coverage for issue #2145 on main (v2).
 *
 * On SDK v1, `tools/list` emitted an empty `inputSchema: {}` for tool schemas
 * wrapped in ZodEffects/ZodPipeline (via `.refine()`, `.superRefine()`,
 * `.transform()` or `.pipe()`), because the v1 converter only read the top-level
 * `.shape`. On main the `standardSchemaToJsonSchema` refactor delegates to
 * Zod's own converters, which walk wrapper types natively, so the bug does not
 * reproduce. These tests pin that behavior: for each wrapper kind, `tools/list`
 * must emit the underlying object's JSON Schema properties, and `tools/call`
 * must still enforce the wrapper's runtime validation.
 *
 * main only supports Zod v4 (`zod/v4`), so the matrix covers v4 only.
 */
import type { JSONRPCMessage } from '@modelcontextprotocol/core-internal';
import { InMemoryTransport, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/core-internal';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';

import { McpServer } from '../../src/index';

interface ToolJson {
    name: string;
    inputSchema: { type?: string; properties?: Record<string, unknown> };
    outputSchema?: { type?: string; properties?: Record<string, unknown> };
}

interface JsonRpcResponse {
    result?: {
        tools?: ToolJson[];
        isError?: boolean;
        content?: Array<Record<string, unknown>>;
    };
    error?: { code: number; message: string };
}

interface Harness {
    request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse>;
    close(): Promise<void>;
}

async function startToolServer(register: (server: McpServer) => void): Promise<Harness> {
    const server = new McpServer({ name: 'wrapped-schema-regression', version: '1.0.0' });
    register(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await clientTransport.start();

    const responses: JSONRPCMessage[] = [];
    clientTransport.onmessage = message => responses.push(message);

    let nextId = 1;
    const sendAndWait = async (method: string, params: Record<string, unknown> = {}, notification = false) => {
        const id = nextId++;
        await clientTransport.send(
            (notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }) as JSONRPCMessage
        );
        if (notification) return undefined;
        await vi.waitFor(() => expect(responses.some(response => 'id' in response && response.id === id)).toBe(true));
        return responses.find(response => 'id' in response && response.id === id) as JsonRpcResponse;
    };

    await sendAndWait('initialize', {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
    });
    await sendAndWait('notifications/initialized', {}, true);

    return {
        request: (method, params) => sendAndWait(method, params) as Promise<JsonRpcResponse>,
        close: async () => {
            await server.close();
            await clientTransport.close();
        }
    };
}

function buildBaseSchema() {
    return z.object({
        prompt: z.string().min(1),
        count: z.number().int().positive().default(1)
    });
}

const wrappers: Array<{ name: string; build: () => z.ZodType; rejectsLargeCount: boolean }> = [
    {
        name: '.refine',
        build: () => buildBaseSchema().refine(v => v.count <= 100, { message: 'count must be <= 100' }),
        rejectsLargeCount: true
    },
    {
        name: '.superRefine',
        build: () =>
            buildBaseSchema().superRefine((v, ctx) => {
                if (v.count > 100) {
                    ctx.addIssue({ code: 'custom', path: ['count'], message: 'count must be <= 100' });
                }
            }),
        rejectsLargeCount: true
    },
    {
        name: '.transform',
        build: () => buildBaseSchema().transform(v => v),
        rejectsLargeCount: false
    },
    {
        name: '.pipe',
        build: () =>
            buildBaseSchema().pipe(
                z.object({
                    prompt: z.string(),
                    count: z.number()
                })
            ),
        rejectsLargeCount: false
    }
];

describe('tools/list with wrapped inputSchema (issue #2145)', () => {
    it.each(wrappers)('$name: tools/list emits properties from the underlying object', async ({ build }) => {
        const harness = await startToolServer(server => {
            server.registerTool('wrapped', { inputSchema: build() }, async () => ({
                content: [{ type: 'text' as const, text: 'ok' }]
            }));
        });

        try {
            const response = await harness.request('tools/list');
            const wrapped = (response.result?.tools ?? []).find(tool => tool.name === 'wrapped');
            expect(wrapped).toBeDefined();
            expect(wrapped!.inputSchema.type).toBe('object');
            const properties = wrapped!.inputSchema.properties;
            expect(properties).toBeDefined();
            expect(properties!.prompt).toBeDefined();
            expect(properties!.count).toBeDefined();
        } finally {
            await harness.close();
        }
    });

    it.each(wrappers)('$name: tools/call still validates against the wrapped schema', async ({ build, rejectsLargeCount }) => {
        const harness = await startToolServer(server => {
            server.registerTool('wrapped', { inputSchema: build() }, async () => ({
                content: [{ type: 'text' as const, text: 'ok' }]
            }));
        });

        try {
            const okResult = await harness.request('tools/call', { name: 'wrapped', arguments: { prompt: 'hi', count: 5 } });
            expect(okResult.error).toBeUndefined();
            expect(okResult.result?.isError).toBeFalsy();

            if (rejectsLargeCount) {
                const badResult = await harness.request('tools/call', {
                    name: 'wrapped',
                    arguments: { prompt: 'hi', count: 200 }
                });
                expect(badResult.error).toBeUndefined();
                expect(badResult.result?.isError).toBe(true);
                expect(JSON.stringify(badResult.result?.content)).toContain('count');
            }
        } finally {
            await harness.close();
        }
    });

    it('tool without inputSchema still emits the empty object schema', async () => {
        const harness = await startToolServer(server => {
            server.registerTool('no-args', {}, async () => ({
                content: [{ type: 'text' as const, text: 'ok' }]
            }));
        });

        try {
            const response = await harness.request('tools/list');
            const tool = (response.result?.tools ?? []).find(t => t.name === 'no-args');
            expect(tool).toBeDefined();
            expect(tool!.inputSchema).toEqual({ type: 'object', properties: {} });
        } finally {
            await harness.close();
        }
    });

    it('wrapped outputSchema is also emitted in tools/list', async () => {
        const harness = await startToolServer(server => {
            const wrappedOutput = z.object({ result: z.string() }).refine(() => true);
            server.registerTool('with-wrapped-output', { outputSchema: wrappedOutput }, async () => ({
                content: [{ type: 'text' as const, text: 'ok' }],
                structuredContent: { result: 'ok' }
            }));
        });

        try {
            const response = await harness.request('tools/list');
            const tool = (response.result?.tools ?? []).find(t => t.name === 'with-wrapped-output');
            expect(tool).toBeDefined();
            expect(tool!.outputSchema).toBeDefined();
            expect(tool!.outputSchema!.type).toBe('object');
            expect(tool!.outputSchema!.properties).toBeDefined();
            expect(tool!.outputSchema!.properties!.result).toBeDefined();
        } finally {
            await harness.close();
        }
    });
});
