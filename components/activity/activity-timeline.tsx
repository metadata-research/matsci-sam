"use client"

import { LineChart } from '@mui/x-charts/LineChart';
import type { LineSeriesType } from '@mui/x-charts/models';
import { Term, DefinitionRevision, Definition } from '@/drizzle';
import { useMemo } from 'react';

export type TermTimelineProps = {
  tl: {
    term: Term;
    revisions: DefinitionRevision[];
    definitions: Definition[];
  };
  /** Chart height in px. Defaults to 360. */
  height?: number;
};

/**
 * ---------------------------------------------------------------------------
 * Data shaping
 * ---------------------------------------------------------------------------
 * We build a single MUI X Charts `dataset`: one row per distinct revision
 * timestamp, with one numeric column per `definitionId`. Each column holds
 * that definition's `changeDelta` contribution at that timestamp (0 when
 * that definition had no revision at that instant). Giving every series the
 * same dataKey structure and letting them all share `stack: "total"` is what
 * produces the stacked-line/area effect.
 */

type DatasetRow = { date: number } & Record<string, number | null>;

const MS_IN_DAY = 24 // hours/day
  * 60 // minutes/hour
  * 60 // seconds/minute
  * 1000; // ms/minute

function definitionKey(definitionId: number) {
  return `def_${definitionId}`;
}

function buildDataset(revisions: DefinitionRevision[], definitions: Definition[]): {
  dataset: DatasetRow[];
  definitionIds: number[];
} {
  const definitionIds = Array.from(
    new Set(definitions.map((r) => r.definitionNumber)),
  ).sort((a, b) => a - b);

  // Map IDs to creation date
  const definitionCreations = new Map<number, number>();
  for (const def of definitions) {
    const time = new Date(def.createdAt).getTime();
    const date = time - (time % MS_IN_DAY);
    definitionCreations.set(def.definitionNumber, date)
  }

  const rowsByTime = new Map<number, DatasetRow>();

  for (const revision of revisions) {
    const time = new Date(revision.createdAt).getTime();
    const date = time - (time % MS_IN_DAY);
    if (Number.isNaN(date)) continue;

    let row = rowsByTime.get(date);
    if (!row) {
      row = { date: date };
      for (const id of definitionIds) {
        if ((definitionCreations.get(id) ?? 0) <= date) {
          row[definitionKey(id)] = 0;
        } else {
          row[definitionKey(id)] = null;

        }
      }
      rowsByTime.set(date, row);
    }

    for (const def of definitions) {
      if (def.id == revision.definitionId) {
        const key = definitionKey(def.definitionNumber);
        row[key] = (row[key] ?? 0) + Number(revision.changeDelta ?? 0);
      }
    }
  }

  const dataset = Array.from(rowsByTime.values()).sort(
    (a, b) => a.date - b.date,
  );

  return { dataset, definitionIds };
}

// Deterministic palette so lines keep the same color across renders/filters.
const PALETTE = [
  '#5B8FF9',
  '#61DDAA',
  '#F6BD16',
  '#F6903D',
  '#E86452',
  '#6DC8EC',
  '#9270CA',
  '#FF9D4D',
  '#269A99',
  '#FF99C3',
];

export function TermTimeline({ tl, height = 360 }: TermTimelineProps) {
  const { term, revisions, definitions } = tl;

  const { dataset, definitionIds } = useMemo(
    () => buildDataset(revisions, definitions),
    [revisions, definitions],
  );

  const series: LineSeriesType[] = useMemo(
    () =>
      definitionIds.map((definitionId, index) => ({
        type: 'line' as const,
        id: definitionKey(definitionId),
        dataKey: definitionKey(definitionId),
        label: `Definition #${definitionId}`,
        stack: 'total',
        area: true,
        showMark: 'start',
        curve: 'linear',
        color: PALETTE[index % PALETTE.length],
        valueFormatter: (value) => value === null ? null : `${value}`,
      })),
    [definitionIds],
  );

  const xDomainPadding = useMemo(() => {
    if (dataset.length < 2) return 0;
    const span = dataset[dataset.length - 1].date - dataset[0].date;
    return span * 0.02; // 2% of the visible range on each side
  }, [dataset]);

  if (dataset.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
        }}
      >
        No revision activity yet for “{term.term}”.
      </div>
    );
  }


  return (
    <LineChart
      className='lineChart'
      height={height}
      dataset={dataset}
      xAxis={
        [
          {
            dataKey: 'date',
            scaleType: 'time',
            domainLimit: 'nice',
            min: dataset[0].date - xDomainPadding,
            max: dataset[dataset.length - 1].date + xDomainPadding,
            valueFormatter: (value: number) =>
              new Date(value).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
              }),
          },
        ]}
      yAxis={[{ label: 'Impact' }]}
      series={series}
      slotProps={{
        legend: {
          direction: 'horizontal',
          position: { vertical: 'top', horizontal: 'end' },
        },
      }
      }
      margin={{ top: 60, right: 24, bottom: 40, left: 60 }}
      sx={{
        '& .MuiLineElement-root': {
          strokeWidth: 2.5,
        },
        '& .MuiMarkElement-root': {
          strokeWidth: 2.5,
          r: 4,
        }
      }}
    />
  );
}

export default TermTimeline;
