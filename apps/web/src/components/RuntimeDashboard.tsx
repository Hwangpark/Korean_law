import type { AnalysisHistoryItem } from '../lib/auth';
import type { AnalysisRunSnapshot, OcrReviewSnapshot, RuntimeTimelineItem } from '../types/app-ui';

type RuntimeDashboardProps = {
  currentRun: AnalysisRunSnapshot | null;
  activeJobId: string | null;
  runtimeTimeline: RuntimeTimelineItem[];
  analysisHistory: AnalysisHistoryItem[];
  historyBusy: boolean;
  historyActiveCaseId?: string | null;
  onOpenHistory?: (item: AnalysisHistoryItem) => void;
  historyOpeningCaseId?: string | null;
  formatContextType: (value: string) => string;
  formatInputMode: (value: 'text' | 'image') => string;
  formatKoreanDateTime: (value: string) => string;
  formatDuration: (durationMs?: number) => string;
};

export function RuntimeDashboard({
  currentRun,
  activeJobId,
  runtimeTimeline,
  analysisHistory,
  historyBusy,
  historyActiveCaseId,
  onOpenHistory,
  historyOpeningCaseId,
  formatContextType,
  formatInputMode,
  formatKoreanDateTime,
  formatDuration,
}: RuntimeDashboardProps) {
  const hasRun = Boolean(currentRun || activeJobId);
  const review = currentRun?.ocrReview ?? null;

  function getReviewLabel(value: OcrReviewSnapshot) {
    if (value.status === 'ok') return 'OCR 안정';
    if (value.status === 'review') return '검토 권장';
    if (value.status === 'uncertain') return '확인 필요';
    return '텍스트 입력';
  }

  return (
    <section className="runtime-dashboard">
      <div className="runtime-dashboard-card">
        <div className="runtime-dashboard-head">
          <div>
            <h3 className="section-title">런타임 대시보드</h3>
            <p className="runtime-dashboard-sub">현재 실행 흐름과 최근 분석 기록을 한 곳에서 봅니다.</p>
          </div>
          {activeJobId && <span className="runtime-job-pill">JOB {activeJobId.slice(0, 8)}</span>}
        </div>

        {hasRun ? (
          <>
            {currentRun && (
              <div className="runtime-run-summary">
                <span>{formatInputMode(currentRun.inputMode)}</span>
                <span>{formatContextType(currentRun.contextType)}</span>
                <span>{formatKoreanDateTime(currentRun.submittedAt)}</span>
                <span>{currentRun.inputMode === 'image' ? currentRun.imageName ?? '이미지 업로드' : `본문 ${currentRun.textLength}자`}</span>
                {review && (
                  <span className={`runtime-review-pill runtime-review-pill-${review.status}`}>
                    {getReviewLabel(review)}
                    {typeof review.confidenceScore === 'number' ? ` · ${Math.round(review.confidenceScore * 100)}%` : ''}
                  </span>
                )}
              </div>
            )}
            {review && review.requiresHumanReview && (
              <div className="runtime-review-card">
                <strong>OCR 검토 메모</strong>
                <p>{review.recommendedAction ?? '원문 이미지와 추출 텍스트를 함께 확인해 주세요.'}</p>
                {review.reasons.length > 0 && (
                  <div className="runtime-review-reasons">
                    {review.reasons.map((reason) => (
                      <span key={reason}>{reason}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="runtime-timeline-list">
              {runtimeTimeline.map((step) => (
                <div key={step.agentId} className={`runtime-timeline-item runtime-timeline-item-${step.status}`}>
                  <div className="runtime-timeline-dot">
                    {step.status === 'done' ? '✓' : step.status === 'active' ? <span className="step-dot-pulse" /> : <span className="step-dot" />}
                  </div>
                  <div className="runtime-timeline-copy">
                    <strong>{step.label}</strong>
                    <span>{step.description}</span>
                  </div>
                  <div className="runtime-timeline-meta">
                    {step.finishedAt ? formatKoreanDateTime(step.finishedAt) : step.startedAt ? '진행 중' : '대기'}
                    {step.durationMs ? <em>{formatDuration(step.durationMs)}</em> : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="runtime-empty">아직 실행한 분석이 없습니다. 텍스트나 이미지를 넣고 시작해보세요.</div>
        )}
      </div>

      <div className="runtime-history-card">
        <div className="runtime-dashboard-head">
          <div>
            <h3 className="section-title">최근 분석 히스토리</h3>
            <p className="runtime-dashboard-sub">로그인 시 최근 결과 요약을 빠르게 확인할 수 있습니다.</p>
          </div>
        </div>

        {historyBusy ? (
          <div className="runtime-empty">히스토리를 불러오는 중입니다...</div>
        ) : analysisHistory.length > 0 ? (
          <div className="runtime-history-list">
            {analysisHistory.slice(0, 5).map((item) => {
              const isActive = historyActiveCaseId === item.caseId;
              const isOpening = historyOpeningCaseId === item.caseId;
              return (
                <div key={item.caseId} className={`runtime-history-item${isActive ? ' runtime-history-item-active' : ''}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.summary}</p>
                  </div>
                  <div className="runtime-history-meta">
                    <span>{item.canSue ? '고소 검토' : '쟁점 약함'}</span>
                    <span>Lv.{item.riskLevel}</span>
                    <span>{formatContextType(item.contextType)}</span>
                    <span>{formatKoreanDateTime(item.createdAt)}</span>
                  </div>
                  {onOpenHistory && (
                    <button className="runtime-history-open-btn" type="button" onClick={() => onOpenHistory(item)} disabled={isOpening}>
                      {isOpening ? '불러오는 중...' : isActive ? '열람 중' : '다시 열기'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="runtime-empty">표시할 히스토리가 없습니다. 로그인 후 분석하면 여기에 쌓입니다.</div>
        )}
      </div>
    </section>
  );
}
