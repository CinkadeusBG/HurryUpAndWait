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
import { AttractionViewModel } from '../../../../core/models/theme-parks.models';
import {
  DEFAULT_CHART_PALETTE,
  computeWaitAxisMax,
  destroyChart,
} from '../../../../core/utils/chart.utils';
import { classifyWaitBand, shortenAttractionName } from '../../utils/board-data.utils';

@Component({
  selector: 'app-board-waits-chart',
  standalone: true,
  template: `
    <div class="chart-shell" [class.is-empty]="!rides.length">
      <canvas #canvas></canvas>
      @if (!rides.length) {
        <span class="empty-label">No posted waits to chart</span>
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
        min-height: 8rem;
      }

      .chart-shell.is-empty canvas {
        opacity: 0.15;
      }

      .empty-label {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: var(--text-muted);
        font-size: 0.85rem;
      }
    `,
  ],
})
export class BoardWaitsChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true })
  private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() rides: AttractionViewModel[] = [];
  @Input() accent = '#3b9eff';

  private chart: Chart<'bar'> | null = null;
  private viewReady = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) {
      return;
    }
    if (changes['rides'] || changes['accent']) {
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

    if (!this.rides.length) {
      return;
    }

    const labels = this.rides.map((ride) => shortenAttractionName(ride.name, 22));
    const values = this.rides.map((ride) => ride.waitTime ?? 0);
    const colors = this.rides.map((ride) => bandColor(classifyWaitBand(ride.waitTime)));

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors.map((color) => `${color}cc`),
            borderColor: colors,
            borderWidth: 1,
            borderRadius: 6,
            barPercentage: 0.72,
            categoryPercentage: 0.8,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 450,
          easing: 'easeOutQuart',
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.x ?? 0} min`,
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: computeWaitAxisMax(values),
            grid: { color: DEFAULT_CHART_PALETTE.grid },
            ticks: {
              color: DEFAULT_CHART_PALETTE.text,
              callback: (value) => `${value}m`,
            },
          },
          y: {
            grid: { display: false },
            ticks: {
              color: DEFAULT_CHART_PALETTE.text,
              font: { size: 11 },
            },
          },
        },
      },
    };

    this.chart = new Chart(this.canvasRef.nativeElement, config);
  }
}

function bandColor(band: 'major' | 'moderate' | 'light'): string {
  switch (band) {
    case 'major':
      return '#f87171';
    case 'moderate':
      return '#fb923c';
    default:
      return '#4ade80';
  }
}
