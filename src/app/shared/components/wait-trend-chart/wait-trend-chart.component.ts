import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Chart } from 'chart.js/auto';
import { WaitTimeSnapshot } from '../../../core/models/historical.models';
import {
  DEFAULT_CHART_PALETTE,
  WaitChartPalette,
  buildLineChartConfig,
  destroyChart,
  formatTimeLabel,
  waitValueForChart,
} from '../../../core/utils/chart.utils';

@Component({
  selector: 'app-wait-trend-chart',
  standalone: true,
  template: `
    <div class="chart-shell" [class.is-compact]="compact" [class.is-empty]="!hasData">
      <canvas #canvas></canvas>
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

      canvas {
        width: 100% !important;
        height: 100% !important;
      }
    `,
  ],
})
export class WaitTrendChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input({ required: true }) entries: WaitTimeSnapshot[] = [];
  @Input() timeZone = 'America/New_York';
  @Input() compact = false;
  @Input() palette: WaitChartPalette = DEFAULT_CHART_PALETTE;

  hasData = false;
  private chart: Chart<'line'> | null = null;
  private viewReady = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.renderChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['entries'] || changes['palette'] || changes['timeZone']) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    destroyChart(this.chart);
    this.chart = null;
  }

  private renderChart(): void {
    if (!this.viewReady) {
      return;
    }

    const operatingEntries = this.entries.filter(
      (entry) => entry.status === 'OPERATING' && entry.waitTime !== null
    );
    this.hasData = operatingEntries.length > 1;

    destroyChart(this.chart);
    this.chart = null;

    if (!this.hasData) {
      return;
    }

    const labels = operatingEntries.map((entry) =>
      formatTimeLabel(entry.timestamp, this.timeZone)
    );
    const values = operatingEntries.map((entry) => waitValueForChart(entry.waitTime));

    this.chart = new Chart(
      this.canvasRef.nativeElement,
      buildLineChartConfig(labels, values, this.palette, {
        plugins: { legend: { display: false }, tooltip: { enabled: !this.compact } },
        scales: {
          x: { display: !this.compact, ticks: { maxTicksLimit: this.compact ? 0 : 4 } },
          y: { display: !this.compact, ticks: { maxTicksLimit: this.compact ? 0 : 4 } },
        },
      })
    );
  }
}