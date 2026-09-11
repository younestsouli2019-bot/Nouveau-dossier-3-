'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, RefreshCw, Send, Sparkles, Trash2, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

declare global {
  interface Window {
    puter?: any
  }
}

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }

const MODELS = [
  { value: 'gpt-5-nano', label: 'GPT-5 Nano (default)' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
  { value: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
  { value: 'llama-4-scout', label: 'Meta Llama 4 Scout' },
]

const SUGGESTIONS = [
  'Explain how vector databases work in simple terms',
  'Write a short poem about distributed systems',
  'Help me debug: Why is my useEffect running twice?',
  'Summarize the key ideas of The Pragmatic Programmer',
]

function waitForPuter(): Promise<any> {
  return new Promise((resolve) => {
    if (window.puter) return resolve(window.puter)
    const started = Date.now()
    const iv = setInterval(() => {
      if (window.puter) {
        clearInterval(iv)
        resolve(window.puter)
      } else if (Date.now() - started > 15000) {
        clearInterval(iv)
        resolve(null)
      }
    }, 50)
  })
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'system', content: 'You are a helpful, concise assistant.' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(true)
  const [model, setModel] = useState(MODELS[0].value)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  const visible = messages.filter((m) => m.role !== 'system')

  const sendMessage = async (text?: string) => {
    const prompt = (text ?? input).trim()
    if (!prompt || loading) return
    setInput('')
    setError(null)

    const history = [...messages, { role: 'user', content: prompt } as ChatMessage]
    setMessages(history)
    setLoading(true)

    let puter: any
    try {
      puter = await waitForPuter()
      if (!puter) {
        setError("Puter.js is still loading or was blocked. Check the browser console and reload the page.")
        setLoading(false)
        return
      }
    } catch {
      setError("Puter.js failed to load. Reload the page and try again.")
      setLoading(false)
      return
    }

    const apiMessages = history.map((m) => ({ role: m.role, content: m.content }))

    try {
      if (streaming) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '' }])
        const resp = await puter.ai.chat(apiMessages, { model, stream: true, normalize: true })
        let acc = ''
        for await (const part of resp) {
          if (part?.type === 'error') {
            setError(part.message || 'Unexpected stream error')
            break
          }
          if (part?.type === 'text' && part.text) {
            acc += part.text
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { role: 'assistant', content: acc }
              return next
            })
          }
        }
        if (!acc && !error) {
          setMessages((prev) => {
            const next = [...prev]
            if (next[next.length - 1].role === 'assistant' && next[next.length - 1].content === '') {
              next.pop()
            }
            return next
          })
        }
      } else {
        const resp = await puter.ai.chat(apiMessages, { model, normalize: true })
        const content = resp?.message?.content
        const final = Array.isArray(content)
          ? content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n')
          : (typeof content === 'string' ? content : JSON.stringify(resp) ?? 'No response.')
        setMessages((prev) => [...prev, { role: 'assistant', content: final }])
      }
    } catch (e: any) {
      setMessages((prev) => {
        const next = [...prev]
        if (next[next.length - 1].role === 'assistant' && next[next.length - 1].content === '') {
          next.pop()
        }
        return next
      })
      setError(e?.message || 'The AI call failed. Please try again.')
    }

    setLoading(false)
  }

  const reset = () => {
    if (loading) return
    setMessages([{ role: 'system', content: 'You are a helpful, concise assistant.' }])
    setError(null)
    setInput('')
  }

  return (
    <>
      <Script src="https://js.puter.com/v2/" strategy="afterInteractive" />

      <div className="min-h-screen flex flex-col bg-background">
        {/* Header */}
        <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">Puter AI Chat</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">Ask any question — powered by 500+ AI models</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-52 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={streaming}
                  onChange={(e) => setStreaming(e.target.checked)}
                  className="accent-emerald-600"
                />
                Stream
              </label>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={reset} disabled={loading} title="Clear conversation">
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 flex flex-col">
          {/* Messages */}
          <Card className="flex-1 min-h-[50vh] flex flex-col">
            <CardContent className="p-4 flex-1 flex flex-col">
              <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto custom-scrollbar pr-1">
                {visible.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center mb-4">
                      <Sparkles className="w-7 h-7" />
                    </div>
                    <p className="text-muted-foreground text-sm mb-6 max-w-md">
                      A self-contained AI chat powered by Puter.js. Choose a model, type a question, and hit send.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-2 w-full max-w-lg">
                      {SUGGESTIONS.map((s) => (
                        <Button key={s} variant="outline" size="sm" className="h-auto py-2 px-3 text-xs justify-start whitespace-normal text-left" onClick={() => sendMessage(s)}>
                          {s}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {visible.map((m, i) => (
                  <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
                    {m.role !== 'user' && (
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shrink-0 mt-1">
                        <Bot className="w-4 h-4" />
                      </div>
                    )}
                    <div className={`max-w-[80%] ${m.role === 'user' ? 'order-first' : ''}`}>
                      <div className={`px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                        m.role === 'user'
                          ? 'bg-emerald-600 text-white rounded-br-sm'
                          : 'bg-muted text-foreground rounded-tl-sm'
                      }`}>
                        {m.content || '…'}
                        {loading && i === visible.length - 1 && m.role === 'assistant' && (
                          <span className="inline-block ml-1 animate-pulse">
                            <Loader2 className="w-3.5 h-3.5 inline animate-spin" />
                          </span>
                        )}
                      </div>
                    </div>
                    {m.role === 'user' && (
                      <div className="w-7 h-7 rounded-lg bg-slate-700 text-white flex items-center justify-center shrink-0 mt-1">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                ))}

                {error && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
                    <span className="font-medium">Error:</span> {error}
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="mt-4 flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder="Type your message… (Enter to send)"
                  className="flex-1"
                  disabled={loading}
                />
                <Button onClick={() => sendMessage()} disabled={loading || !input.trim()} className="gap-1.5">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Footer — required Puter attribution */}
          <footer className="mt-4 pb-6 text-center">
            <a
              href="https://developer.puter.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Powered by Puter
            </a>
          </footer>
        </main>
      </div>
    </>
  )
}