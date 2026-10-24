import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from './markdown'

const baseUrl = 'https://elearning.unipd.it/dlm'

describe('htmlToMarkdown', () => {
  it('converte titoli, paragrafi e link', () => {
    const markdown = htmlToMarkdown(
      '<h2>Lezione</h2><p>Testo <strong>importante</strong>.</p><p><a href="/dlm/mod/page/view.php?id=1">Apri</a></p>',
      baseUrl
    )
    expect(markdown).toContain('## Lezione')
    expect(markdown).toContain('Testo **importante**.')
    expect(markdown).toContain('[Apri](https://elearning.unipd.it/dlm/mod/page/view.php?id=1)')
  })

  it('rimuove script e risolve i link relativi', () => {
    const markdown = htmlToMarkdown(
      '<script>alert(1)</script><p><img src="/dlm/pluginfile.php/1/mod_page/content/1/img.png" alt="Schema"></p>',
      baseUrl
    )
    expect(markdown).not.toContain('alert')
    expect(markdown).toContain(
      '![Schema](https://elearning.unipd.it/dlm/pluginfile.php/1/mod_page/content/1/img.png)'
    )
  })

  it('rimuove i token dai link', () => {
    const markdown = htmlToMarkdown(
      '<p><a href="https://elearning.unipd.it/dlm/pluginfile.php/1/file.pdf?token=abc">PDF</a></p>',
      baseUrl
    )
    expect(markdown).toContain('[PDF](https://elearning.unipd.it/dlm/pluginfile.php/1/file.pdf)')
    expect(markdown).not.toContain('token=')
  })

  it('conserva i link esterni', () => {
    const markdown = htmlToMarkdown(
      '<p><a href="https://example.com/video">Video</a></p>',
      baseUrl
    )
    expect(markdown).toContain('[Video](https://example.com/video)')
  })
})
