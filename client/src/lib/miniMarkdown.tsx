import { Fragment, type ReactNode } from 'react';

/**
 * A deliberately small Markdown renderer for pull-request bodies and comments.
 *
 * It returns React nodes rather than an HTML string, so untrusted text from
 * GitHub can never become markup — there is no `dangerouslySetInnerHTML` and
 * therefore no escaping to get wrong. It covers what PR descriptions actually
 * use: headings, fenced and inline code, bold/italic, links, lists, quotes,
 * rules and task lists. Anything else falls through as plain text, which is
 * the right failure mode for a viewer.
 */

/**
 * Called for each `[[wikilink]]` found. Memory notes are the only source that
 * uses them, and they need the click to go somewhere — so the renderer stays
 * generic and the caller decides what a link means.
 */
export type WikiLinkRenderer = (target: string, label: string, key: string) => ReactNode;

/** Inline spans: code first, so formatting inside backticks is left alone. */
function renderInline(text: string, keyPrefix: string, wiki?: WikiLinkRenderer): ReactNode[] {
  const out: ReactNode[] = [];
  // `code` | [[wikilink]] | **bold** | __bold__ | *em* | _em_ | ~~strike~~ | [label](href)
  const pattern =
    /(`[^`\n]+`)|(\[\[[^\[\]\n]+\]\])|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)|(\[[^\]\n]*\]\([^)\s]+\))/g;

  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${i++}`;

    if (token.startsWith('`')) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[[')) {
      const inner = token.slice(2, -2);
      const bar = inner.indexOf('|');
      const target = (bar >= 0 ? inner.slice(0, bar) : inner).split('#')[0].trim();
      const label = (bar >= 0 ? inner.slice(bar + 1) : inner).split('#')[0].trim();
      // Without a handler this is just text — which is the correct reading of
      // a wikilink anywhere there is no graph to follow it into.
      out.push(wiki ? wiki(target, label, key) : <Fragment key={key}>{label}</Fragment>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      out.push(<s key={key}>{token.slice(2, -2)}</s>);
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      // Only linkify schemes a viewer should follow; anything else stays text.
      const safe = /^https?:\/\//i.test(href);
      out.push(
        safe ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {label || href}
          </a>
        ) : (
          <Fragment key={key}>{label || href}</Fragment>
        ),
      );
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({
  source,
  wikiLink,
  empty = 'No description.',
}: {
  source: string;
  wikiLink?: WikiLinkRenderer;
  empty?: string;
}): ReactNode {
  if (!source?.trim()) return <p className="md-empty">{empty}</p>;

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    const children = items.map((item, idx) => {
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
      if (task) {
        return (
          <li key={idx} className="md-task">
            <input type="checkbox" checked={task[1].toLowerCase() === 'x'} readOnly tabIndex={-1} />
            <span>{renderInline(task[2], `t${key}-${idx}`, wikiLink)}</span>
          </li>
        );
      }
      return <li key={idx}>{renderInline(item, `l${key}-${idx}`, wikiLink)}</li>;
    });
    blocks.push(
      ordered ? <ol key={`b${key++}`}>{children}</ol> : <ul key={`b${key++}`}>{children}</ul>,
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code: consume to the closing fence (or end of input).
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      flushList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      blocks.push(
        <pre key={`b${key++}`} className="md-pre">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushList();
      blocks.push(<hr key={`b${key++}`} />);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length, 6);
      const Tag = `h${level}` as 'h1';
      blocks.push(
        <Tag key={`b${key++}`} className={`md-h${level}`}>
          {renderInline(heading[2], `h${key}`, wikiLink)}
        </Tag>,
      );
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      blocks.push(
        <blockquote key={`b${key++}`}>{renderInline(quote[1], `q${key}`, wikiLink)}</blockquote>,
      );
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    flushList();
    blocks.push(<p key={`b${key++}`}>{renderInline(line, `p${key}`, wikiLink)}</p>);
  }

  flushList();
  return <div className="md">{blocks}</div>;
}
