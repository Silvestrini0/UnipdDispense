import TurndownService from 'turndown'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
  strongDelimiter: '**'
})

turndown.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button'])

export function htmlToMarkdown(html: string, baseUrl?: string): string {
  const markdown = turndown.turndown(html).trim()
  if (!baseUrl) {
    return markdown
  }
  return rewriteLinks(markdown, baseUrl)
}

function rewriteLinks(markdown: string, baseUrl: string): string {
  return markdown.replace(/\]\(([^)\s]+)([^)]*)\)/g, (match, rawTarget: string, suffix: string) => {
    if (!rawTarget || rawTarget.startsWith('#') || rawTarget.startsWith('data:')) {
      return match
    }
    try {
      const url = new URL(rawTarget, baseUrl)
      url.searchParams.delete('token')
      url.searchParams.delete('wstoken')
      return `](${url.toString()}${suffix})`
    } catch {
      return match
    }
  })
}
