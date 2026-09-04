/**
 * A note the install owner leaves for whoever they handed a scoped login to.
 *
 * When an agency gives a client their own login, that person lands in a
 * workspace where some pillars are full and others are deliberately empty, and
 * nothing on the screen tells them which is which. "Not built", "not connected
 * yet" and "not yours to see" all render identically — as a blank panel — and
 * the reading most people take from a blank panel is the first one.
 *
 * That is answered in a paragraph by the person who set the workspace up, and
 * it is answered once rather than in a support thread every time.
 *
 * WHY IT LOOKS LIKE HIGHLIGHTER PEN
 *
 * It was a bordered card first. A bordered card, on a page of bordered cards,
 * is furniture — the eye files it with the chrome and moves on, which is fatal
 * for the one element on the screen written specifically for this reader. So it
 * is marked the way a person marks a paragraph that matters: over the words
 * rather than around them.
 *
 * `box-decoration-break: clone` is what makes it a pen stroke instead of a
 * yellow rectangle — without it, a highlight behind wrapped text paints one
 * continuous box around the whole block. The uneven gradient stops stop the
 * ends looking laser-cut, and the ink is forced dark because the text now sits
 * on the marker rather than on the page, so it must stay legible whichever
 * theme is underneath.
 */

const CSS = `
.bw-note-wrap { max-width: 820px; margin: 2px 0 20px; }
.bw-note-title, .bw-note-body {
  display: inline;
  color: #1a1508;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  padding: 0.14em 0.42em;
  margin: 0 -0.18em;
  border-radius: 0.22em;
}
.bw-note-title {
  font-weight: 800;
  font-size: 1.02rem;
  background: linear-gradient(104deg,
    rgba(255,225,60,0)   0.4%,
    rgba(255,225,60,.95) 2.2%,
    rgba(255,214,30,.92) 96%,
    rgba(255,225,60,0)   99.2%);
  box-shadow: 0 0 0.4em rgba(255,214,30,.55);
}
.bw-note-body {
  font-size: 0.93rem;
  line-height: 2.05;
  white-space: pre-wrap;
  background: linear-gradient(101deg,
    rgba(255,240,130,0)   0.6%,
    rgba(255,240,130,.72) 2.6%,
    rgba(253,232,110,.68) 96%,
    rgba(255,240,130,0)   99%);
}
`

interface Props {
  /** Free text set on the client record. Nothing renders when it is empty. */
  note?: string
  /** True for a client-scoped session. The note is addressed to them, and is
   *  noise on the owner's own screen. */
  scoped?: boolean
  title?: string
}

export default function ScopedNote({ note, scoped, title = 'Read this first' }: Props) {
  if (!scoped || !note || !note.trim()) return null
  return (
    <div className="bw-note-wrap">
      <style>{CSS}</style>
      <div style={{ marginBottom: 12 }}>
        <span className="bw-note-title">✍️ {title}</span>
      </div>
      <div>
        <span className="bw-note-body">{note}</span>
      </div>
    </div>
  )
}
