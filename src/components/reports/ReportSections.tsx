import Link from 'next/link';
import {
  ChevronRight,
  AlertTriangle,
  Diamond,
  Activity,
  ExternalLink,
  TrendingDown,
} from 'lucide-react';
import {
  VELOCITY_WEEKS,
  type ProjectHealth,
  type ProjectOverviewRow,
  type ProjectDashboard,
} from '@/lib/reports';
import { Donut } from './Donut';
import { Burndown } from './Burndown';

// Zeile, die in den Gantt oder die Ressourcen springt. Auf Lese-Links gäbe es
// dort kein Ziel (interactive=false), dann bleibt sie reiner Text.
function RowLink({
  interactive,
  href,
  style,
  children,
}: {
  interactive: boolean;
  href: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (!interactive) return <div style={style}>{children}</div>;
  return (
    <Link href={href} className="report-row-link" style={style}>
      {children}
    </Link>
  );
}

// ─── Overview-Tabelle ────────────────────────────────────────────────────

export function OverviewSection({
  rows,
  selectedId,
}: {
  rows: ProjectOverviewRow[];
  selectedId: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-ink-3)' }}>
        Keine Projekte aktiviert.
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface-2)',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-ink-2)',
        }}
      >
        Projekt-Übersicht
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr
            style={{
              background: 'var(--color-surface-3)',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--color-ink-3)',
            }}
          >
            <Th style={{ width: 32 }} />
            <Th>Projekt</Th>
            <Th right>Fortschritt</Th>
            <Th right>Offen</Th>
            <Th right>Überfällig</Th>
            <Th right>Konflikte</Th>
            <Th>Nächster Meilenstein</Th>
            <Th>Letzte Sync</Th>
            <Th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ProjectRow key={row.id} row={row} isSelected={row.id === selectedId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectRow({ row, isSelected }: { row: ProjectOverviewRow; isSelected: boolean }) {
  return (
    <tr
      style={{
        background: isSelected ? 'var(--color-selected)' : undefined,
        borderTop: '1px solid var(--color-border)',
      }}
      className="report-row"
    >
      <Td>
        <HealthDot health={row.health} />
      </Td>
      <Td>
        <Link
          href={`/reports?project=${row.id}`}
          style={{
            color: 'var(--color-ink)',
            textDecoration: 'none',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {row.name}
        </Link>
      </Td>
      <Td right>
        <ProgressBar percent={row.donePercent} />
      </Td>
      <Td right>
        <span className="mono tabnum">{row.openWps}</span>
        <span style={{ color: 'var(--color-ink-3)' }}> / {row.totalWps}</span>
      </Td>
      <Td right>
        {row.overdueWps > 0 ? (
          <span
            className="mono tabnum"
            style={{ color: 'var(--color-status-blocked)', fontWeight: 600 }}
          >
            {row.overdueWps}
          </span>
        ) : (
          <span style={{ color: 'var(--color-ink-4)' }}>—</span>
        )}
      </Td>
      <Td right>
        {row.conflictsCount > 0 ? (
          <span
            className="mono tabnum"
            style={{ color: 'var(--color-status-blocked)', fontWeight: 600 }}
          >
            {row.conflictsCount}
          </span>
        ) : (
          <span style={{ color: 'var(--color-ink-4)' }}>—</span>
        )}
      </Td>
      <Td>
        {row.nextMilestone ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Diamond size={10} style={{ color: 'var(--color-status-milestone)' }} />
            <span>{row.nextMilestone.title}</span>
            {row.nextMilestone.date && (
              <span className="mono" style={{ color: 'var(--color-ink-3)', fontSize: 11 }}>
                {fmtDate(row.nextMilestone.date)}
              </span>
            )}
          </span>
        ) : (
          <span style={{ color: 'var(--color-ink-4)' }}>—</span>
        )}
      </Td>
      <Td>
        <span style={{ color: 'var(--color-ink-3)', fontSize: 11 }}>
          {row.lastFullSyncAt ? fmtRelative(row.lastFullSyncAt) : 'nie'}
        </span>
      </Td>
      <Td>
        <Link
          href={`/reports?project=${row.id}`}
          style={{ color: 'var(--color-ink-3)', display: 'inline-flex' }}
          title="Dashboard anzeigen"
        >
          <ChevronRight size={14} />
        </Link>
      </Td>
    </tr>
  );
}

function HealthDot({ health }: { health: ProjectHealth }) {
  const color =
    health === 'good'
      ? 'var(--color-status-done)'
      : health === 'warning'
        ? 'var(--color-status-milestone)'
        : 'var(--color-status-blocked)';
  const label = health === 'good' ? 'Gut' : health === 'warning' ? 'Warnung' : 'Kritisch';
  return (
    <span
      title={label}
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
      }}
    />
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        justifyContent: 'flex-end',
      }}
    >
      <div
        style={{
          width: 80,
          height: 6,
          background: 'var(--color-surface-3)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background:
              percent >= 90
                ? 'var(--color-status-done)'
                : percent >= 50
                  ? 'var(--color-status-open)'
                  : 'var(--color-status-milestone)',
          }}
        />
      </div>
      <span className="mono tabnum" style={{ minWidth: 32, textAlign: 'right' }}>
        {percent}%
      </span>
    </div>
  );
}

// ─── Drill-Down: Projekt-Dashboard ───────────────────────────────────────

export function DashboardSection({
  dashboard,
  interactive = true,
}: {
  dashboard: ProjectDashboard;
  interactive?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Quick-Stats + Donut */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 14,
        }}
      >
        <div
          className="card"
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Donut
            percent={dashboard.donePercent}
            overdueRatio={dashboard.donut.overdueRatio}
          />
          <div style={{ fontSize: 11, color: 'var(--color-ink-3)', textAlign: 'center' }}>
            <span className="mono tabnum">{dashboard.doneWps}</span> /{' '}
            <span className="mono tabnum">{dashboard.totalWps}</span> Aufgaben fertig
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <AlertSection dashboard={dashboard} interactive={interactive} />
        </div>
      </div>

      {/* Verlauf vor Detail: Burndown breit, Velocity daneben. Unter 1100px
          bricht das Grid auf zwei Zeilen um — der Burndown misst seine Breite
          selbst und zeichnet dann einfach schmaler. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
        {/* 2:1 solange beide Basisbreiten nebeneinander passen, sonst
            untereinander in voller Breite. */}
        <div style={{ flex: '2 1 520px', minWidth: 0 }}>
          <BurndownSection dashboard={dashboard} />
        </div>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <VelocitySection velocity={dashboard.velocity} />
        </div>
      </div>

      {/* Top-WP-Listen pro Kategorie (Offen / Fertig / Überfällig) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 14,
        }}
      >
        <TopWpList
          interactive={interactive}
          title="Aktuell offen"
          count={dashboard.openWps - dashboard.overdueWps}
          items={dashboard.topOpen}
          accent="open"
          projectId={dashboard.id}
        />
        <TopWpList
          interactive={interactive}
          title="Zuletzt fertig"
          count={dashboard.doneWps}
          items={dashboard.topDone}
          accent="done"
          projectId={dashboard.id}
        />
        <TopWpList
          interactive={interactive}
          title="Überfällig"
          count={dashboard.overdueWps}
          items={dashboard.topOverdue}
          accent="block"
          projectId={dashboard.id}
        />
      </div>

      {/* Listen: Überfällige + Meilensteine */}
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}
      >
        <OverdueList project={dashboard} interactive={interactive} />
        <MilestoneList project={dashboard} />
      </div>
    </div>
  );
}

function Legend({ items }: { items: Array<{ color: string; label: string; value?: number }> }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span style={{ width: 10, height: 10, background: it.color, borderRadius: 2 }} />
          <span style={{ color: 'var(--color-ink-2)' }}>{it.label}</span>
          {it.value != null && (
            <span className="mono tabnum" style={{ color: 'var(--color-ink-3)' }}>
              {it.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function BurndownSection({ dashboard }: { dashboard: ProjectDashboard }) {
  const { burndown, burndownEstimated } = dashboard;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <SectionHeader icon={<TrendingDown size={11} />} title="Burndown">
        {/* Ohne Zahlen: die Linien tragen ihre aktuellen Werte am Ende, eine
            zweite Zahl in der Legende müsste einen anderen Zeitpunkt meinen. */}
        <Legend
          items={[
            { color: 'var(--color-accent)', label: 'Ist' },
            { color: 'var(--color-ink-2)', label: 'Plan' },
            { color: 'var(--color-ink-4)', label: 'Baseline' },
          ]}
        />
      </SectionHeader>
      {burndown.length < 2 ? (
        <Empty>Zu wenig Daten für einen Verlauf.</Empty>
      ) : (
        <Burndown points={burndown} estimated={burndownEstimated} />
      )}
    </div>
  );
}

function VelocitySection({ velocity }: { velocity: ProjectDashboard['velocity'] }) {
  const maxVal = Math.max(1, ...velocity.flatMap((v) => [v.closedCount, v.createdCount]));
  const closedSum = velocity.reduce((s, v) => s + v.closedCount, 0);
  const createdSum = velocity.reduce((s, v) => s + v.createdCount, 0);

  const CHART_H = 140; // px
  const Y_AXIS_W = 28; // px
  const yTicks = maxVal === 1 ? [0, 1] : [0, Math.ceil(maxVal / 2), maxVal];

  return (
    <div className="card" style={{ padding: 14 }}>
      <SectionHeader icon={<Activity size={11} />} title={`Velocity (${VELOCITY_WEEKS} KW)`}>
        <Legend
          items={[
            { color: 'var(--color-status-open)', label: 'Erstellt', value: createdSum },
            { color: 'var(--color-status-done)', label: 'Geschlossen', value: closedSum },
          ]}
        />
      </SectionHeader>
      <div style={{ padding: '14px 4px 4px', display: 'flex', gap: 6 }}>
        {/* Y-Achse */}
        <div
          style={{
            width: Y_AXIS_W,
            height: CHART_H,
            position: 'relative',
            flexShrink: 0,
          }}
        >
          {yTicks.map((t) => (
            <div
              key={t}
              className="mono"
              style={{
                position: 'absolute',
                right: 4,
                bottom: `${(t / maxVal) * 100}%`,
                transform: 'translateY(50%)',
                fontSize: 9,
                color: 'var(--color-ink-3)',
              }}
            >
              {t}
            </div>
          ))}
        </div>
        {/* Chart-Bereich: Flex-Spalten, jede KW eine Spalte mit 2 Bars.
            Gridlines liegen IM selben Container wie die Bars damit sie y-genau
            mit Bar-Boden (value=0) und Bar-Höhe (value=max) abschließen. */}
        <div style={{ flex: 1 }}>
          <div style={{ position: 'relative', height: CHART_H }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
              }}
            >
              {yTicks.map((t) => (
                <div
                  key={t}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: `${(t / maxVal) * 100}%`,
                    height: 1,
                    background: t === 0 ? 'var(--color-border-2)' : 'var(--color-border)',
                  }}
                />
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                height: '100%',
                gap: 2,
                position: 'relative',
              }}
            >
            {velocity.map((v) => {
              const createdPct = (v.createdCount / maxVal) * 100;
              const closedPct = (v.closedCount / maxVal) * 100;
              return (
                <div
                  key={v.weekStart.toISOString()}
                  style={{
                    flex: 1,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'flex-end',
                    gap: 2,
                    height: '100%',
                    minWidth: 0,
                  }}
                >
                  {/* Nur Bars rendern wenn Count > 0 — justifyContent:center
                      zentriert den oder die sichtbaren Bars dann unter der
                      Spalten-Mitte (wo auch das KW-Label sitzt). */}
                  {v.createdCount > 0 && (
                    <VelocityBar
                      heightPct={createdPct}
                      count={v.createdCount}
                      color="var(--color-status-open)"
                      title={`KW ${v.isoWeek}: ${v.createdCount} erstellt`}
                    />
                  )}
                  {v.closedCount > 0 && (
                    <VelocityBar
                      heightPct={closedPct}
                      count={v.closedCount}
                      color="var(--color-status-done)"
                      title={`KW ${v.isoWeek}: ${v.closedCount} geschlossen`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          </div>
          {/* KW-Labels */}
          <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
            {velocity.map((v) => (
              <div
                key={v.weekStart.toISOString()}
                className="mono"
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 9,
                  color: 'var(--color-ink-3)',
                  minWidth: 0,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }}
              >
                KW{v.isoWeek}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function VelocityBar({
  heightPct,
  count,
  color,
  title,
}: {
  heightPct: number;
  count: number;
  color: string;
  title: string;
}) {
  return (
    <div
      title={title}
      style={{
        width: '46%',
        maxWidth: 18,
        height: heightPct > 0 ? `${heightPct}%` : 1,
        background: heightPct > 0 ? color : 'transparent',
        borderRadius: '2px 2px 0 0',
        position: 'relative',
      }}
    >
      {count > 0 && (
        <span
          className="mono"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 9,
            color,
            fontWeight: 600,
            marginBottom: 1,
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function OverdueList({ project, interactive }: { project: ProjectDashboard; interactive: boolean }) {
  return (
    <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <SectionHeader
        icon={<AlertTriangle size={11} style={{ color: 'var(--color-status-blocked)' }} />}
        title="Überfällig (Top 5)"
      />
      {project.overdueList.length === 0 ? (
        <Empty>Keine überfälligen Aufgaben</Empty>
      ) : (
        <div>
          {project.overdueList.map((o) => (
            <RowLink
              key={o.id}
              href={`/projects/${project.id}/gantt?wp=${o.id}`}
              interactive={interactive}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderTop: '1px solid var(--color-border)',
                fontSize: 12,
                textDecoration: 'none',
                color: 'var(--color-ink)',
              }}
            >
              <span
                className="mono"
                style={{
                  color: 'var(--color-status-blocked)',
                  fontWeight: 600,
                  fontSize: 11,
                  minWidth: 48,
                }}
              >
                {o.daysOverdue}d
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  className="mono"
                  style={{ color: 'var(--color-ink-3)', marginRight: 6, fontSize: 11 }}
                >
                  #{o.iid}
                </span>
                {o.title}
              </span>
              {interactive && <ExternalLink
                size={11}
                style={{ color: 'var(--color-ink-4)', flexShrink: 0 }}
              />}
            </RowLink>
          ))}
        </div>
      )}
    </div>
  );
}

function MilestoneList({ project }: { project: ProjectDashboard }) {
  return (
    <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <SectionHeader
        icon={<Diamond size={11} style={{ color: 'var(--color-status-milestone)' }} />}
        title="Meilensteine"
      />
      {project.upcomingMilestones.length === 0 ? (
        <Empty>Keine Meilensteine</Empty>
      ) : (
        <div>
          {project.upcomingMilestones.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderTop: '1px solid var(--color-border)',
                fontSize: 12,
              }}
            >
              <Diamond
                size={11}
                style={{
                  color: m.state === 'closed' ? 'var(--color-ink-4)' : 'var(--color-status-milestone)',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  textDecoration: m.state === 'closed' ? 'line-through' : 'none',
                  color: m.state === 'closed' ? 'var(--color-ink-3)' : 'var(--color-ink)',
                }}
              >
                {m.title}
              </span>
              {m.dueDate && (
                <span className="mono" style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                  {fmtDate(m.dueDate)}
                </span>
              )}
              {m.daysUntil !== null && m.state !== 'closed' && (
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    minWidth: 40,
                    textAlign: 'right',
                    color:
                      m.daysUntil < 0
                        ? 'var(--color-status-blocked)'
                        : m.daysUntil <= 7
                          ? 'var(--color-accent-h)'
                          : 'var(--color-ink-3)',
                    fontWeight: 600,
                  }}
                >
                  {m.daysUntil < 0 ? `${m.daysUntil}d` : `+${m.daysUntil}d`}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'var(--color-surface-2)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ color: 'var(--color-ink-3)' }}>{icon}</span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-ink-2)',
        }}
      >
        {title}
      </span>
      <div style={{ flex: 1 }} />
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '16px 14px',
        color: 'var(--color-ink-3)',
        fontSize: 12,
        fontStyle: 'italic',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      {children}
    </div>
  );
}

function Th({ children, right, style }: { children?: React.ReactNode; right?: boolean; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        padding: '8px 12px',
        textAlign: right ? 'right' : 'left',
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <td
      style={{
        padding: '10px 12px',
        textAlign: right ? 'right' : 'left',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
  );
}

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
}

function fmtRelative(d: Date): string {
  const diff = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diff < 1) return 'gerade';
  if (diff < 60) return `${diff}m`;
  const h = Math.round(diff / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// ─── Alert-Sektion (Konflikte + Resource-Überlast) ────────────────────────
function AlertSection({ dashboard, interactive }: { dashboard: ProjectDashboard; interactive: boolean }) {
  const hasAlerts = dashboard.conflicts.length > 0 || dashboard.resourceWarnings.length > 0;
  if (!hasAlerts) {
    return (
      <div
        className="card"
        style={{
          padding: 14,
          color: 'var(--color-status-done)',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--color-status-done)',
            flexShrink: 0,
          }}
        />
        Keine Alarme — alles im grünen Bereich
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <SectionHeader
        icon={<AlertTriangle size={11} style={{ color: 'var(--color-status-blocked)' }} />}
        title="Alarme"
      >
        <span style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
          {dashboard.conflicts.length + dashboard.resourceWarnings.length} aktiv
        </span>
      </SectionHeader>
      {dashboard.conflicts.length > 0 && (
        <div>
          <SubHeaderBar label="Dependency-Konflikte" count={dashboard.conflicts.length} />
          {dashboard.conflicts.slice(0, 5).map((c) => (
            <RowLink
              key={`${c.successorWpId}-${c.type}`}
              href={`/projects/${dashboard.id}/gantt?wp=${c.successorWpId}`}
              interactive={interactive}
              style={alertRowStyle()}
            >
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  background: '#fef2f2',
                  color: 'var(--color-status-blocked)',
                  borderRadius: 3,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {c.type}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span className="mono" style={{ color: 'var(--color-ink-3)', marginRight: 4, fontSize: 11 }}>
                  #{c.successorIid}
                </span>
                {c.successorTitle}
              </span>
              <span
                className="mono"
                style={{ fontSize: 10, color: 'var(--color-status-blocked)', fontWeight: 600, flexShrink: 0 }}
              >
                {c.daysOverlap}d
              </span>
            </RowLink>
          ))}
          {dashboard.conflicts.length > 5 && (
            <div style={{ padding: '6px 14px', fontSize: 10, color: 'var(--color-ink-3)', fontStyle: 'italic' }}>
              + {dashboard.conflicts.length - 5} weitere — Liste im Gantt-Status-Bar
            </div>
          )}
        </div>
      )}
      {dashboard.resourceWarnings.length > 0 && (
        <div>
          <SubHeaderBar
            label="Überlastete Personen (> 5 WPs/KW)"
            count={dashboard.resourceWarnings.length}
          />
          {dashboard.resourceWarnings.slice(0, 5).map((w, i) => (
            <RowLink
              key={`${w.gitlabUserId}-${w.isoWeek}-${i}`}
              href="/resources"
              interactive={interactive}
              style={alertRowStyle()}
            >
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  background: '#fef2f2',
                  color: 'var(--color-status-blocked)',
                  borderRadius: 3,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                KW{w.isoWeek}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{w.name}</span>
              <span
                className="mono"
                style={{ fontSize: 10, color: 'var(--color-status-blocked)', fontWeight: 600, flexShrink: 0 }}
              >
                {w.count} WPs
              </span>
            </RowLink>
          ))}
        </div>
      )}
    </div>
  );
}

function alertRowStyle(): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderTop: '1px solid var(--color-border)',
    fontSize: 12,
    textDecoration: 'none',
    color: 'var(--color-ink)',
  };
}

function SubHeaderBar({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        padding: '6px 14px',
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--color-ink-3)',
        background: 'var(--color-surface-2)',
        borderTop: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span>{label}</span>
      <span className="mono" style={{ color: 'var(--color-ink-2)' }}>
        {count}
      </span>
    </div>
  );
}

// ─── Top-WP-Liste pro Kategorie ─────────────────────────────────────────
function TopWpList({
  title,
  count,
  items,
  accent,
  projectId,
  interactive,
}: {
  title: string;
  count: number;
  items: ProjectDashboard['topOpen'];
  accent: 'open' | 'done' | 'block';
  projectId: string;
  interactive: boolean;
}) {
  const accentColor =
    accent === 'open'
      ? 'var(--color-status-open)'
      : accent === 'done'
        ? 'var(--color-status-done)'
        : 'var(--color-status-blocked)';
  return (
    <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '10px 14px',
          background: 'var(--color-surface-2)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: accentColor,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--color-ink-2)',
          }}
        >
          {title}
        </span>
        <div style={{ flex: 1 }} />
        <span className="mono tabnum" style={{ fontSize: 16, fontWeight: 700, color: accentColor }}>
          {count}
        </span>
      </div>
      {items.length === 0 ? (
        <Empty>Keine Aufgaben</Empty>
      ) : (
        <div>
          {items.map((w) => (
            <RowLink
              key={w.id}
              href={`/projects/${projectId}/gantt?wp=${w.id}`}
              interactive={interactive}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderTop: '1px solid var(--color-border)',
                fontSize: 12,
                textDecoration: 'none',
                color: 'var(--color-ink)',
              }}
            >
              <span
                className="mono"
                style={{ fontSize: 10, color: 'var(--color-ink-3)', flexShrink: 0 }}
              >
                #{w.iid}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {w.title}
              </span>
              {w.daysOverdue !== undefined ? (
                <span
                  className="mono"
                  style={{ fontSize: 10, color: 'var(--color-status-blocked)', fontWeight: 600, flexShrink: 0 }}
                >
                  {w.daysOverdue}d
                </span>
              ) : w.state !== 'closed' ? (
                <span
                  className="mono"
                  style={{ fontSize: 10, color: 'var(--color-ink-3)', flexShrink: 0 }}
                >
                  {w.progressPercent}%
                </span>
              ) : (
                <span
                  className="mono"
                  style={{ fontSize: 10, color: 'var(--color-ink-3)', flexShrink: 0 }}
                >
                  {fmtDate(w.endDate)}
                </span>
              )}
            </RowLink>
          ))}
        </div>
      )}
    </div>
  );
}
