import type { DetailPanelData } from '../types/app-ui';

type DetailPanelProps = {
  data: DetailPanelData | null;
  title: string;
  subtitle: string;
  emptyMessage: string;
  onClose: () => void;
  inline?: boolean;
  countLabel?: string;
};

export function DetailPanel({
  data,
  title,
  subtitle,
  emptyMessage,
  onClose,
  inline = false,
  countLabel,
}: DetailPanelProps) {
  return (
    <>
      {!inline && (
        <div className="detail-panel-head">
          <div>
            <h3 className="section-title">{title}</h3>
            <p className="detail-panel-sub">{subtitle}</p>
          </div>
          {data && (
            <div className="detail-panel-actions">
              <span className="detail-panel-count">
                {countLabel ?? (data.references.length > 0 ? `${data.references.length}개 근거` : '카드 상세')}
              </span>
              <button className="detail-close-btn" type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          )}
        </div>
      )}

      {data ? (
        <div className={`detail-panel-body${inline ? ' detail-panel-body-inline' : ''}`}>
          {inline && (
            <div className="detail-panel-toolbar">
              <span className="detail-panel-count">
                {countLabel ?? (data.references.length > 0 ? `${data.references.length}개 근거` : '선택한 근거')}
              </span>
              <button className="detail-close-btn" type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          )}
          <div className="detail-panel-kicker">{data.eyebrow}</div>
          <h4 className="detail-panel-title">{data.title}</h4>
          <p className="detail-panel-summary">{data.summary}</p>

          {data.metadata.length > 0 && (
            <div className="detail-metadata">
              {data.metadata.map((meta) => (
                <div key={`${meta.label}-${meta.value}`} className="detail-metadata-item">
                  <span>{meta.label}</span>
                  <strong>{meta.value}</strong>
                </div>
              ))}
            </div>
          )}

          {data.highlights.length > 0 && (
            <div className="detail-highlight-list">
              {data.highlights.map((item) => (
                <div key={item} className="detail-highlight-item">
                  <span className="detail-highlight-dot" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          )}

          {data.provenance && (
            <div className="detail-provenance">
              <div className="detail-provenance-head">
                <strong>근거 연결</strong>
                {data.provenance.citationId && <span>{data.provenance.citationId}</span>}
              </div>

              {(data.provenance.referenceKey ||
                data.provenance.lawReferenceId ||
                data.provenance.referenceId ||
                data.provenance.precedentReferenceIds.length > 0) && (
                <div className="detail-provenance-grid">
                  {data.provenance.referenceKey && (
                    <div>
                      <span>참조 키</span>
                      <strong>{data.provenance.referenceKey}</strong>
                    </div>
                  )}
                  {data.provenance.lawReferenceId && (
                    <div>
                      <span>법령 근거</span>
                      <strong>{data.provenance.lawReferenceId}</strong>
                    </div>
                  )}
                  {data.provenance.referenceId && (
                    <div>
                      <span>판례 근거</span>
                      <strong>{data.provenance.referenceId}</strong>
                    </div>
                  )}
                  {data.provenance.precedentReferenceIds.length > 0 && (
                    <div>
                      <span>연결 판례</span>
                      <strong>{data.provenance.precedentReferenceIds.join(', ')}</strong>
                    </div>
                  )}
                </div>
              )}

              {data.provenance.matchReason && (
                <p className="detail-provenance-reason">{data.provenance.matchReason}</p>
              )}

              {data.provenance.snippetText && (
                <blockquote className="detail-provenance-snippet">
                  {data.provenance.snippetField && <span>{data.provenance.snippetField}</span>}
                  {data.provenance.snippetText}
                </blockquote>
              )}

              {data.provenance.queryRefs.length > 0 && (
                <div className="detail-query-list">
                  {data.provenance.queryRefs.slice(0, 8).map((query, queryIndex) => (
                    <span
                      key={`${query.text}-${query.bucket}-${query.channel}-${queryIndex}`}
                      className="detail-query-chip"
                      title={[...query.sources, ...query.issueTypes, ...query.legalElementSignals].join(', ')}
                    >
                      {query.text}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {data.references.length > 0 ? (
            <div className="detail-reference-list">
              {data.references.map((ref) =>
                ref.url ? (
                  <a
                    key={`${ref.title}-${ref.summary}-${ref.url}`}
                    className="detail-reference-item"
                    href={ref.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className="detail-reference-text">
                      <strong>{ref.title}</strong>
                      <span>{ref.summary}</span>
                    </div>
                    {ref.subtitle && <span className="detail-reference-subtitle">{ref.subtitle}</span>}
                    <span className="detail-reference-link">원문</span>
                  </a>
                ) : (
                  <div key={`${ref.title}-${ref.summary}`} className="detail-reference-item detail-reference-static">
                    <div className="detail-reference-text">
                      <strong>{ref.title}</strong>
                      <span>{ref.summary}</span>
                    </div>
                    {ref.subtitle && <span className="detail-reference-subtitle">{ref.subtitle}</span>}
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="detail-empty">참고 라이브러리가 없으면 카드의 핵심 정보만 우선 표시됩니다.</div>
          )}
        </div>
      ) : (
        <div className="detail-empty">{emptyMessage}</div>
      )}
    </>
  );
}
