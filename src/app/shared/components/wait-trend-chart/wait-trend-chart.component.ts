import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { Chart } from 'chart.js/auto';
import { WaitTimeSnapshot } from '../../../core/models/historical.models';
import {
  DEFAULT_CHART_PALETTE,
  WaitChartPalette,
  buildDetailWaitTrendConfig,
  buildLineChartConfig,
  destroyChart,
  ensureWaitTrendCrosshairPlugin,
  findNearestWaitTrendIndex,
  formatTimeLabel,
  hasChartWaitValue,
  SPARKLINE_MIN_POINTS,
  waitValueForChart,
} from '../../../core/utils/chart.utils';

@Component({
  selector: 'app-wait-trend-chart',
  standalone: true,
  template: `
    <div
      class="chart-shell"
      [class.is-compact]="compact"
      [class.is-detail]="!compact"
      [class.is-large]="large"
      [class.is-empty]="!hasData"
      [class.is-hovering]="!!hoverTime"
      (mouseleave)="onChartLeave()"
    >
      <canvas #canvas></canvas>
      @if (hoverTime) {
        <div class="hover-readout" [style.left.px]="hoverX">
          <span class="hover-time">{{ hoverTime }}</span>
          @if (hoverWait !== null) {
            <span class="hover-wait">{{ hoverWait }}m</span>
          }
        </div>
      }
      @if (!hasData) {
        <span class="empty-label">No trend yet</span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .chart-shell {
        position: relative;
        width: 100%;
        height: 5.5rem;
      }

      .chart-shell.is-compact {
        height: 3.25rem;
      }

      .chart-shell.is-large {
        height: 22rem;
      }

      .chart-shell.is-empty canvas {
        opacity: 0.15;
      }

      .empty-label {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        font-size: 0.68rem;
        color: var(--text-muted);
        pointer-events: none;
      }

      .hover-readout {
        position: absolute;
        top: 0.1rem;
        transform: translateX(-50%);
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.1rem 0.38rem;
        border-radius: var(--radius-pill);
        font-size: 0.62rem;
        font-weight: 700;
        line-height: 1.2;
        color: #e2e8f0;
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.35);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
        pointer-events: none;
        white-space: nowrap;
        z-index: 2;
      }

      .chart-shell.is-detail .hover-readout {
        top: 0.35rem;
        padding: 0.18rem 0.5rem;
        font-size: 0.72rem;
      }

      .hover-wait {
        color: var(--accent-primary);
      }

      .chart-shell.is-hovering canvas {
        cursor: crosshair;
      }

      canvas {
        width: 100% !important;
        height: 100% !important;
      }
    `,
  ],
})
export class WaitTrendChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input({ required: true }) entries: WaitTimeSnapshot[] = [];
  @Input() timeZone = 'America/New_York';
  @Input() compact = false;
  @Input() large = false;
  @Input() palette: WaitChartPalette = DEFAULT_CHART_PALETTE;

  hasData = false;
  hoverTime: string | null = null;
  hoverWait: number | null = null;
  hoverX = 0;

  private chart: Chart<'line'> | null = null;
  private viewReady = false;
  private chartEntries: WaitTimeSnapshot[] = [];

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.renderChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['entries'] ||
      changes['palette'] ||
      changes['timeZone'] ||
      changes['compact'] ||
      changes['large']
    ) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    destroyChart(this.chart);
    this.chart = null;
  }

  onChartLeave(): void {
    this.clearHover();
    this.chart?.setActiveElements([]);
    this.chart?.draw();
  }

  private renderChart(): void {
    if (!this.viewReady) {
      return;
    }

    this.chartEntries = this.entries.filter((entry) => hasChartWaitValue(entry))
      .sort(
        (left, right) =>
          new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
      );
    const minPoints = this.compact ? SPARKLINE_MIN_POINTS : 2;
    this.hasData = this.chartEntries.length >= minPoints;
    this.clearHover();

    destroyChart(this.chart);
    this.chart = null;

    if (!this.hasData) {
      return;
    }

    ensureWaitTrendCrosshairPlugin();

    if (!this.compact) {
      const config = buildDetailWaitTrendConfig(
        this.chartEntries,
        this.timeZone,
        this.palette
      );
      config.options = {
        ...config.options,
        onHover: (_event, elements, chart) => {
          this.handleChartHover(_event, elements, chart);
        },
      };
      this.chart = new Chart(this.canvasRef.nativeElement, config);
      return;
    }

    const labels = this.chartEntries.map((entry) =>
      formatTimeLabel(entry.timestamp, this.timeZone)
    );
    const values = this.chartEntries.map((entry) => waitValueForChart(entry.waitTime));

    this.chart = new Chart(
      this.canvasRef.nativeElement,
      buildLineChartConfig(labels, values, this.palette, {
        interaction: {
          mode: 'nearest' as const,
          intersect: false,
          axis: 'x' as const,
        },
        onHover: (_event, elements, chart) => {
          this.handleChartHover(_event, elements, chart);
        },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      })
    );
  }

  private handleChartHover(
    event: { x?: number | null; y?: number | null },
    elements: { index: number }[],
    chart: Chart
  ): void {
    const lineChart = chart as Chart<'line'>;
    let index = elements[0]?.index ?? -1;

    if (index < 0 && !this.compact && event.x != null && event.y != null) {
      const { left, right, top, bottom } = lineChart.chartArea;
      if (event.x >= left && event.x <= right && event.y >= top && event.y <= bottom) {
        index = findNearestWaitTrendIndex(lineChart, event.x);
      }
    }

    if (index < 0) {
      this.clearHover();
      lineChart.setActiveElements([]);
      lineChart.draw();
      return;
    }

    lineChart.setActiveElements([{ datasetIndex: 0, index }]);
    this.updateHover(index);
    lineChart.draw();
  }

  private updateHover(index: number): void {
    const entry = this.chartEntries[index];
    const chart = this.chart;
    if (!entry || !chart) {
      this.clearHover();
      return;
    }

    const point = chart.getDatasetMeta(0).data[index];
    if (!point) {
      this.clearHover();
      return;
    }

    const canvas = this.canvasRef.nativeElement;
    const scale = canvas.getBoundingClientRect().width / chart.width;
    const displayX = point.x * scale;
    const edgePadding = this.compact ? 34 : 42;
    this.hoverX = Math.max(
      edgePadding,
      Math.min(displayX, canvas.clientWidth - edgePadding)
    );
    this.hoverTime = formatTimeLabel(entry.timestamp, this.timeZone);
    this.hoverWait = entry.waitTime;
    this.cdr.detectChanges();
  }

  private clearHover(): void {
    this.hoverTime = null;
    this.hoverWait = null;
    this.hoverX = 0;
    this.cdr.detectChanges();
  }
}