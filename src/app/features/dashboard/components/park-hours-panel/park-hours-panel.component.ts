import { Component, Input } from '@angular/core';
import { ScheduleEntry } from '../../../../core/models/theme-parks.models';
import {
  formatScheduleEntryLabel,
  formatScheduleEntrySubtitle,
  formatShowTime,
} from '../../../../core/utils/attraction.utils';

@Component({
  selector: 'app-park-hours-panel',
  standalone: true,
  templateUrl: './park-hours-panel.component.html',
  styleUrl: './park-hours-panel.component.scss',
})
export class ParkHoursPanelComponent {
  @Input({ required: true }) schedule: ScheduleEntry[] = [];

  get todayEntries(): ScheduleEntry[] {
    const today = new Date().toISOString().slice(0, 10);
    return this.schedule.filter((entry) => entry.date === today);
  }

  formatTime(iso?: string): string {
    if (!iso) {
      return '—';
    }
    return formatShowTime(iso);
  }

  entryLabel(entry: ScheduleEntry): string {
    return formatScheduleEntryLabel(entry);
  }

  entrySubtitle(entry: ScheduleEntry): string | null {
    return formatScheduleEntrySubtitle(entry);
  }

  entryTrackId(entry: ScheduleEntry): string {
    return [entry.type, entry.openingTime, entry.closingTime, entry.description].join(
      '|'
    );
  }
}