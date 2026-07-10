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
import { WeatherHourlyPoint } from '../../../../core/models/weather.models';
import { destroyChart } from '../../../../core/utils/chart.utils';
import { formatShowTime } from '../../../../core/utils/attraction.utils';

@Component({
  selector: 'app-board-weather-chart',
  standalone: true,
  template: `
    <div class="chart-shell" [class.is-empty]="!hourly.length">
      <canvas #canvas></canvas>
      @if (!hourly.length) {
        <span class="empty-label">Forecast unavailable</span>
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
export class BoardWeatherChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true })
  private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() hourly: WeatherHourlyPoint[] = [];
  @Input() timezone = 'America/New_York';
  @Input() accent = '#3b9eff';

  private chart: Chart | null = null;
  private viewReady = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) {
      return;
    }
    if (changes['hourly'] || changes['timezone'] || changes['accent']) {
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

    if (!this.hourly.length) {
      return;
    }

    const labels = this.hourly.map((hour) =>
      formatShowTime(hour.time, this.timezone).replace(/:00/, '')
    );
    const temps = this.hourly.map((hour) => hour.temperatureF);
    const rain = this.hourly.map((hour) =>
      hour.precipProbability === null ? null : hour.precipProbability
    );

    const tempMin = Math.min(...temps);
    const tempMax = Math.max(...temps);
    const tempPad = Math.max(4, Math.round((tempMax - tempMin) * 0.15));

    const config: ChartConfiguration = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Temp °F',
            data: temps,
            yAxisID: 'yTemp',
            borderColor: '#fb923c',
            backgroundColor: 'rgba(251, 146, 60, 0.14)',
            borderWidth: 2.5,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#fb923c',
            tension: 0.35,
            fill: true,
          },
          {
            label: 'Rain %',
            data: rain,
            yAxisID: 'yRain',
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.12)',
            borderWidth: 2.5,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#38bdf8',
            tension: 0.35,
            fill: true,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        animation: { duration: 500, easing: 'easeOutQuart' },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#a8b6d8',
              boxWidth: 12,
              padding: 12,
              font: { size: 12 },
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const value = ctx.parsed.y;
                if (value === null || value === undefined) {
                  return ` ${ctx.dataset.label}: —`;
                }
                if (ctx.dataset.yAxisID === 'yRain') {
                  return ` Rain: ${value}%`;
                }
                return ` Temp: ${value}°F`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color: '#8fa0c4',
              font: { size: 11 },
              maxRotation: 0,
            },
          },
          yTemp: {
            type: 'linear',
            position: 'left',
            min: Math.floor(tempMin - tempPad),
            max: Math.ceil(tempMax + tempPad),
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: {
              color: '#fb923c',
              callback: (value) => `${value}°`,
              font: { size: 11 },
            },
            title: {
              display: true,
              text: '°F',
              color: '#fb923c',
              font: { size: 11 },
            },
          },
          yRain: {
            type: 'linear',
            position: 'right',
            min: 0,
            max: 100,
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#38bdf8',
              callback: (value) => `${value}%`,
              font: { size: 11 },
              stepSize: 25,
            },
            title: {
              display: true,
              text: 'Rain',
              color: '#38bdf8',
              font: { size: 11 },
            },
          },
        },
      },
    };

    this.chart = new Chart(this.canvasRef.nativeElement, config);
  }
}
