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
import { Chart, ChartConfiguration } from 'chart.js/auto';
import {
  DEFAULT_CHART_PALETTE,
  computeWaitAxisMax,
  destroyChart,
} from '../../../../core/utils/chart.utils';

export interface AvgWaitPoint {
  label: string;
  wait: number;
}

@Component({
  selector: 'app-board-avg-wait-chart',
  standalone: true,
  template: `
    <div class="chart-shell" [class.is-empty]="!points.length">
      <canvas #canvas></canvas>
      @if (!points.length) {
        <span class="empty-label">Avg wait trend warming up</span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }
      .chart-shell {
        position: relative;
        height: 100%;
        min-height: 5.5rem;
      }
      .chart-shell.is-empty canvas {
        opacity: 0.12;
      }
      .empty-label {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: var(--text-muted);
        font-size: 0.9rem;
        text-align: center;
        padding: 0.5rem;
      }
    `,
  ],
})
export class BoardAvgWaitChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true })
  private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() points: AvgWaitPoint[] = [];
  @Input() accent = '#3b9eff';

  private chart: Chart<'line'> | null = null;
  private viewReady = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) {
      return;
    }
    if (changes['points'] || changes['accent']) {
      this.render();
    }
  }

  ngOnDestroy(): void {
    destroyChart(this.chart);
    this.chart = null;
  }

  private render(): void {
    destroyChart(this.chart);
    this.chart = null;

    if (!this.points.length) {
      return;
    }

    const labels = this.points.map((point) => point.label);
    const values = this.points.map((point) => point.wait);
    const fill = hexToRgba(this.accent, 0.18);

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: values,
            borderColor: this.accent,
            backgroundColor: fill,
            borderWidth: 2.5,
            pointRadius: values.length > 18 ? 0 : 3,
            pointHoverRadius: 5,
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 550, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.y ?? 0} min avg`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color: DEFAULT_CHART_PALETTE.text,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 6,
              font: { size: 11 },
            },
          },
          y: {
            beginAtZero: true,
            max: computeWaitAxisMax(values),
            grid: { color: DEFAULT_CHART_PALETTE.grid },
            ticks: {
              color: DEFAULT_CHART_PALETTE.text,
              callback: (value) => `${value}m`,
              font: { size: 11 },
            },
          },
        },
      },
    };

    this.chart = new Chart(this.canvasRef.nativeElement, config);
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return `rgba(59, 158, 255, ${alpha})`;
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
