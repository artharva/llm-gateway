import type { ChatProvider } from '../../src/providers/groq';
import type { ChatRequest, ProviderResult } from '../../src/types';

/** A provider whose replies and failures a test controls. */
export class FakeProvider implements ChatProvider {
  calls: ChatRequest[] = [];
  next: () => Promise<ProviderResult> = async () => ({
    text: 'hello from fake',
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  constructor(readonly name = 'fake') {}

  async chat(req: ChatRequest): Promise<ProviderResult> {
    this.calls.push(req);
    return this.next();
  }
}
