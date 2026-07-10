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
import { destroyChart } from '../../../../core/utils/chart.utils';

@Component({
  selector: 'app-board-band-mix-chart',
  standalone: true,
  template: `
    <div class="chart-shell" [class.is-empty]="total === 0">
      <canvas #canvas></canvas>
      @if (total === 0) {
        <span class="empty-label">No posted waits</span>
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
export class BoardBandMixChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true })
  private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() major = 0;
  @Input() moderate = 0;
  @Input() light = 0;

  private chart: Chart<'doughnut'> | null = null;
  private viewReady = false;

  get total(): number {
    return this.major + this.moderate + this.light;
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) {
      return;
    }
    if (changes['major'] || changes['moderate'] || changes['light']) {
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

    if (this.total === 0) {
      return;
    }

    const config: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels: ['Major', 'Moderate', 'Light'],
        datasets: [
          {
            data: [this.major, this.moderate, this.light],
            backgroundColor: ['#f87171cc', '#fb923ccc', '#4ade80cc'],
            borderColor: ['#f87171', '#fb923c', '#4ade80'],
            borderWidth: 1.5,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        animation: { duration: 500, easing: 'easeOutQuart' },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#8fa0c4',
              boxWidth: 10,
              padding: 10,
              font: { size: 12 },
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const value = Number(ctx.raw ?? 0);
                const pct = this.total ? Math.round((value / this.total) * 100) : 0;
                return ` ${ctx.label}: ${value} (${pct}%)`;
              },
            },
          },
        },
      },
    };

    this.chart = new Chart(this.canvasRef.nativeElement, config);
  }
}
