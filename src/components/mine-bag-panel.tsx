"use client";

export type MineBagCell = {
  id: string;
  key: string;
  name: string;
  label: string;
  color: string;
  count: number;
  full: boolean;
};

export function MineBagPanel({
  open,
  capacity,
  filledStackCount,
  oreCount,
  stackLimit,
  scrapCredits,
  partsCount,
  details,
  cells,
  emptyCellKeys,
  selectedKeys,
  canDropSelected,
  selectedCount,
  onClose,
  onDropSelected,
  onClearSelection,
  onToggleCell,
}: {
  open: boolean;
  capacity: number;
  filledStackCount: number;
  oreCount: number;
  stackLimit: number;
  scrapCredits: number;
  partsCount: number;
  details: string;
  cells: readonly MineBagCell[];
  emptyCellKeys: readonly string[];
  selectedKeys: ReadonlySet<string>;
  canDropSelected: boolean;
  selectedCount: number;
  onClose: () => void;
  onDropSelected: () => void;
  onClearSelection: () => void;
  onToggleCell: (key: string) => void;
}) {
  if (!open) return null;

  return (
    <div className="mine-bag-overlay">
      <button
        type="button"
        aria-label="Close bag"
        onClick={onClose}
        className="mine-bag-backdrop"
      />
      <section
        id="mine-bag-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mine-bag-title"
        data-bag-variant="tool-satchel"
        data-bag-capacity={capacity}
        data-bag-filled={filledStackCount}
        data-bag-ore-count={oreCount}
        data-bag-stack-limit={stackLimit}
        className="mine-bag-satchel"
      >
        <div className="mine-bag-handle" aria-hidden="true" />
        <div
          className="mine-bag-latch mine-bag-latch-left"
          aria-hidden="true"
        />
        <div
          className="mine-bag-latch mine-bag-latch-right"
          aria-hidden="true"
        />
        <div className="mine-bag-shell">
          <header className="mine-bag-lid" data-bag-lid="true">
            <div className="mine-bag-title-row">
              <div>
                <h2 id="mine-bag-title" className="mine-bag-title">
                  Bag {filledStackCount}/{capacity}
                </h2>
                <p className="mine-bag-summary">{details}</p>
              </div>
              <button
                type="button"
                aria-label="Close bag"
                onClick={onClose}
                className="mine-bag-close"
              >
                x
              </button>
            </div>
            <div className="mine-bag-lid-pockets">
              <div className="mine-bag-pocket">
                <span>Scrap</span>
                <strong>{scrapCredits} vibes</strong>
              </div>
              <div className="mine-bag-pocket">
                <span>Parts</span>
                <strong>
                  {partsCount}
                  {partsCount === 1 ? " part" : " parts"}
                </strong>
              </div>
            </div>
          </header>
          <div className="mine-bag-fold" aria-hidden="true" />
          <div className="mine-bag-tray" data-bag-tray="true">
            <div
              className="mine-bag-drop-controls"
              data-bag-drop-controls="true"
            >
              <button
                type="button"
                className="mine-bag-drop-button"
                disabled={!canDropSelected}
                onClick={onDropSelected}
              >
                Drop selected{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </button>
              <button
                type="button"
                className="mine-bag-clear-button"
                disabled={selectedCount === 0}
                onClick={onClearSelection}
              >
                Clear
              </button>
            </div>
            <div data-bag-scroll="true" className="mine-bag-scroll">
              <ol
                aria-label="Bag cells"
                data-bag-cells="true"
                className="mine-bag-cells"
              >
                {cells.map((cell) => {
                  const selected = selectedKeys.has(cell.key);
                  return (
                    <li
                      key={cell.key}
                      title={`${cell.name} x${cell.count}`}
                      data-ore={cell.id}
                      data-stack-count={cell.count}
                      data-stack-full={cell.full ? "true" : "false"}
                      data-selected={selected ? "true" : "false"}
                      className="mine-bag-cell mine-bag-cell-filled"
                      style={{
                        borderColor: cell.color,
                        background: `${cell.color}24`,
                        color: cell.color,
                      }}
                    >
                      <button
                        type="button"
                        className="mine-bag-cell-button"
                        aria-pressed={selected}
                        aria-label={`${selected ? "Unselect" : "Select"} ${cell.name} stack of ${cell.count} for dropping`}
                        onClick={() => onToggleCell(cell.key)}
                      >
                        <span
                          className="mine-bag-resource-graphic"
                          data-resource-graphic="true"
                          aria-hidden="true"
                        >
                          <span className="mine-bag-resource-core">
                            {cell.label}
                          </span>
                        </span>
                        <span className="mine-bag-stack-count">
                          x{cell.count}
                        </span>
                        {cell.full && (
                          <span
                            className="mine-bag-stack-full-overlay"
                            data-stack-full-overlay="true"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
                {emptyCellKeys.map((key) => (
                  <li
                    key={key}
                    data-empty-cell="true"
                    className="mine-bag-cell mine-bag-cell-empty"
                  />
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
