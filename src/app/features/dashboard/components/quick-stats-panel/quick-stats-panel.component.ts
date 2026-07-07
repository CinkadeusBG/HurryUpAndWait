import { Component, Input } from '@angular/core';
import { AttractionViewModel } from '../../../../core/models/theme-parks.models';

interface QuickStat {
  label: string;
  value: string;
  hint?: string;
  icon: string;
  tone: string;
}

@Component({
  selector: 'app-quick-stats-panel',
  standalone: true,
  templateUrl: './quick-stats-panel.component.html',
  styleUrl: './quick-stats-panel.component.scss',
})
export class QuickStatsPanelComponent {
  @Input({ required: true }) openAttractions: AttractionViewModel[] = [];
  @Input({ required: true }) closedCount = 0;

  get stats(): QuickStat[] {
    const rides = this.openAttractions.filter((item) => item.entityType === 'ATTRACTION');
    const operatingRides = rides.filter((item) => item.displayStatus === 'Open');
    const waits = operatingRides
      .map((item) => item.waitTime)
      .filter((wait): wait is number => wait !== null);

    const avgWait =
      waits.length > 0
        ? Math.round(waits.reduce((sum, wait) => sum + wait, 0) / waits.length)
        : null;

    const longest = waits.length > 0 ? Math.max(...waits) : null;
    const shortest = waits.length > 0 ? Math.min(...waits) : null;
    const under15 = waits.filter((wait) => wait < 15).length;

    return [
      {
        label: 'Open attractions',
        value: `${operatingRides.length}`,
        icon: 'pi pi-check-circle',
        tone: 'tone-open',
      },
      {
        label: 'Down rides',
        value: `${rides.length - operatingRides.length}`,
        icon: 'pi pi-exclamation-triangle',
        tone: 'tone-down',
      },
      {
        label: 'Closed / unavailable',
        value: `${this.closedCount}`,
        icon: 'pi pi-lock',
        tone: 'tone-closed',
      },
      {
        label: 'Average wait',
        value: avgWait !== null ? `${avgWait} min` : '—',
        icon: 'pi pi-chart-line',
        tone: 'tone-wait',
      },
      {
        label: 'Shortest wait',
        value: shortest !== null ? `${shortest} min` : '—',
        icon: 'pi pi-arrow-down',
        tone: 'tone-short',
      },
      {
        label: 'Longest wait',
        value: longest !== null ? `${longest} min` : '—',
        icon: 'pi pi-arrow-up',
        tone: 'tone-long',
      },
      {
        label: 'Under 15 min',
        value: `${under15}`,
        hint: 'rides with posted waits',
        icon: 'pi pi-bolt',
        tone: 'tone-fast',
      },
    ];
  }
}