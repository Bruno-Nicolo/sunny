import type { AiProvider } from '../../../../shared/ai'

export const providerNames: Record<AiProvider, string> = {
  chatgpt: 'ChatGPT plan',
  openai: 'OpenAI API',
  anthropic: 'Anthropic API',
  google: 'Google Gemini API',
  openrouter: 'OpenRouter API'
}
