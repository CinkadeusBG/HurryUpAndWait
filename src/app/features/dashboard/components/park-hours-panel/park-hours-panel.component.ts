import { Component, Input } from '@angular/core';
import { ResortId } from '../../../../core/constants/park.constants';
import { ScheduleEntry } from '../../../../core/models/theme-parks.models';
import {
  formatParkDateKey,
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
  @Input() resort: ResortId = 'wdw';
  @Input() parkTimezone = 'America/New_York';

  get todayEntries(): ScheduleEntry[] {
    const today = formatParkDateKey(this.parkTimezone);
    return this.schedule.filter((entry) => entry.date === today);
  }

  formatTime(iso?: string): string {
    if (!iso) {
      return '—';
    }
    return formatShowTime(iso, this.parkTimezone);
  }

  entryLabel(entry: ScheduleEntry): string {
    return formatScheduleEntryLabel(entry, this.resort);
  }

  entrySubtitle(entry: ScheduleEntry): string | null {
    return formatScheduleEntrySubtitle(entry, this.resort);
  }

  entryTrackId(entry: ScheduleEntry): string {
    return [entry.type, entry.openingTime, entry.closingTime, entry.description].join(
      '|'
    );
  }
}