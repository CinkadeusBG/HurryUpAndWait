import { AsyncPipe } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { AttractionViewModel } from '../../../../core/models/theme-parks.models';
import { ClockService } from '../../../../core/services/clock.service';
import {
  getRelevantShowTimes,
  isPerformanceShow,
} from '../../../../core/utils/attraction.utils';

@Component({
  selector: 'app-show-times-panel',
  standalone: true,
  imports: [AsyncPipe],
  templateUrl: './show-times-panel.component.html',
  styleUrl: './show-times-panel.component.scss',
})
export class ShowTimesPanelComponent {
  private readonly clock = inject(ClockService);

  readonly tick$ = this.clock.tick$;

  @Input({ required: true }) shows: AttractionViewModel[] = [];

  showsWithTimes(tick: number): AttractionViewModel[] {
    void tick;
    return this.shows
      .filter(
        (show) =>
          isPerformanceShow(show) &&
          getRelevantShowTimes(show.showtimes).length > 0
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  upcomingShowTimes(show: AttractionViewModel, tick: number): string[] {
    void tick;
    return getRelevantShowTimes(show.showtimes);
  }
}