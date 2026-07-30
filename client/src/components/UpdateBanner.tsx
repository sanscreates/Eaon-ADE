import { useUpdates, formatSize } from '../store/updates';
import { IconDownload, IconX } from './Icons';

/* ═══════════════════════════════════════════════════════════════════════════
   "There is a new version" — the one thing an updater has to say.

   It sits over the bottom-right corner rather than pushing the layout around,
   because an update is never urgent enough to move someone's terminals. It
   only ever appears for a real, newer, un-skipped release: every other state
   of the check is silent, or lives in Settings › About where you went looking.
   ═══════════════════════════════════════════════════════════════════════════ */

export function UpdateBanner() {
  const state = useUpdates((s) => s.state);
  const hidden = useUpdates((s) => s.bannerHidden);
  const download = useUpdates((s) => s.download);
  const openPage = useUpdates((s) => s.openPage);
  const skip = useUpdates((s) => s.skip);
  const hideBanner = useUpdates((s) => s.hideBanner);

  if (hidden || state?.status !== 'available') return null;

  const size = formatSize(state.downloadSize);
  const firstLine = state.notes
    ?.split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0);

  return (
    <div className="upd-banner" role="status">
      <div className="upd-head">
        <span className="upd-icon">
          <IconDownload size={14} />
        </span>
        <div className="upd-title">
          <strong>Version {state.version} is available</strong>
          <span className="upd-sub">
            You have {state.current}
            {size ? ` · ${size} download` : ''}
          </span>
        </div>
        <button className="icon-btn upd-close" title="Not now" onClick={hideBanner}>
          <IconX size={12} />
        </button>
      </div>

      {firstLine && <p className="upd-notes">{firstLine}</p>}

      <div className="upd-actions">
        <button className="btn btn-sm upd-link" onClick={openPage}>
          What's new
        </button>
        <span className="upd-spacer" />
        <button className="btn btn-sm" onClick={skip}>
          Skip this version
        </button>
        <button className="btn btn-sm btn-accent" onClick={download}>
          Download
        </button>
      </div>

      {/* Said once, here, rather than discovered after the download: an
          unsigned build cannot replace itself, so there is a manual step. */}
      <p className="upd-foot">Opens the installer in your browser — drag it to Applications to finish.</p>
    </div>
  );
}
