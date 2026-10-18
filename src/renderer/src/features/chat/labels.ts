import type { AiProvider, ApiProvider } from '../../../../shared/ai'

export const providerNames: Record<AiProvider, string> = {
  chatgpt: 'ChatGPT plan',
  openai: 'OpenAI API',
  anthropic: 'Anthropic API',
  google: 'Google Gemini API',
  openrouter: 'OpenRouter API'
}

export const providerSections: { id: ApiProvider; name: string; providers: AiProvider[] }[] = [
  { id: 'openai', name: 'OpenAI', providers: ['chatgpt', 'openai'] },
  { id: 'anthropic', name: 'Anthropic', providers: ['anthropic'] },
  { id: 'google', name: 'Gemini', providers: ['google'] },
  { id: 'openrouter', name: 'OpenRouter', providers: ['openrouter'] }
]
