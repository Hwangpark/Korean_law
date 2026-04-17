import type { AnalysisHistoryItem } from '../lib/auth';
import type { AnalysisRunSnapshot, RuntimeTimelineItem } from '../types/app-ui';

type RuntimeDashboardProps = {
  currentRun: AnalysisRunSnapshot | null;
  activeJobId: string | null;
  runtimeTimeline: RuntimeTimelineItem[];
  analysisHistory: AnalysisHistoryItem[];
  historyBusy: boolean;
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
  formatContextType,
  formatInputMode,
  formatKoreanDateTime,
  formatDuration,
}: RuntimeDashboardProps) {
  const hasRun = Boolean(currentRun || activeJobId);

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
            {analysisHistory.slice(0, 5).map((item) => (
              <div key={item.caseId} className="runtime-history-item">
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                </div>
                <div className="runtime-history-meta">
                  <span>{item.canSue ? '고소 검토' : '쟁점 약함'}</span>
                  <span>Lv.{item.riskLevel}</span>
                  <span>{formatKoreanDateTime(item.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="runtime-empty">표시할 히스토리가 없습니다. 로그인 후 분석하면 여기에 쌓입니다.</div>
        )}
      </div>
    </section>
  );
}
