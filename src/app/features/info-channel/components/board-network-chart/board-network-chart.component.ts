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

export interface NetworkParkAvg {
  label: string;
  averageWait: number | null;
  accent: string;
  active?: boolean;
}

@Component({
  selector: 'app-board-network-chart',
  standalone: true,
  template: `
    <div class="chart-shell" [class.is-empty]="!hasData">
      <canvas #canvas></canvas>
      @if (!hasData) {
        <span class="empty-label">Network waits loading…</span>
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
        min-height: 7rem;
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
      }
    `,
  ],
})
export class BoardNetworkChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true })
  private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() parks: NetworkParkAvg[] = [];

  private chart: Chart<'bar'> | null = null;
  private viewReady = false;

  get hasData(): boolean {
    return this.parks.some((park) => park.averageWait !== null);
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) {
      return;
    }
    if (changes['parks']) {
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

    if (!this.hasData) {
      return;
    }

    const labels = this.parks.map((park) => park.label);
    const values = this.parks.map((park) => park.averageWait ?? 0);
    const colors = this.parks.map((park) =>
      park.active ? park.accent : `${park.accent}99`
    );

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors.map((color) =>
              color.length === 7 ? `${color}cc` : color
            ),
            borderColor: colors,
            borderWidth: 1,
            borderRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const park = this.parks[ctx.dataIndex];
                return park?.averageWait === null
                  ? ' No data'
                  : ` ${park.averageWait} min avg`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: DEFAULT_CHART_PALETTE.text,
              font: { size: 10 },
              maxRotation: 40,
              minRotation: 0,
            },
          },
          y: {
            beginAtZero: true,
            max: computeWaitAxisMax(values.filter((v) => v > 0)),
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
