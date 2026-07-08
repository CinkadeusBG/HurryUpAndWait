import {
  Component,
  DestroyRef,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ResortId } from '../../../../core/constants/park.constants';
import { ParkLlDailySnapshot } from '../../../../core/models/historical.models';
import { HistoricalDataService } from '../../../../core/services/historical-data.service';
import {
  formatIllLocalDate,
  formatOptionalIllPriceCents,
} from '../../../../core/utils/ill-display.utils';
import {
  ParkLightningLanePricing,
  hasLightningLanePricePair,
} from '../../../../core/utils/lightning-lane.utils';

interface ParkLlHistoryRow {
  localDate: string;
  dateLabel: string;
  multiPass: string | null;
  multiPassSoldOut: boolean;
  premierPass: string | null;
  premierPassSoldOut: boolean;
}

@Component({
  selector: 'app-park-ll-stats-panel',
  standalone: true,
  templateUrl: './park-ll-stats-panel.component.html',
  styleUrl: './park-ll-stats-panel.component.scss',
})
export class ParkLlStatsPanelComponent implements OnChanges {
  private readonly historicalData = inject(HistoricalDataService);
  private readonly destroyRef = inject(DestroyRef);

  @Input({ required: true }) parkId!: string;
  @Input({ required: true }) resort!: ResortId;
  @Input() parkLightningLanePricing: Record<string, ParkLightningLanePricing> =
    {};

  historyLoading = false;
  historyRows: ParkLlHistoryRow[] = [];

  get showPanel(): boolean {
    return this.resort === 'wdw';
  }

  get pricing(): ParkLightningLanePricing | null {
    const entry = this.parkLightningLanePricing[this.parkId];
    if (!entry || !hasLightningLanePricePair(entry.multiPass, entry.premierPass)) {
      return null;
    }

    return entry;
  }

  get hasHistory(): boolean {
    return this.historyRows.length > 0;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['parkId'] || changes['resort']) {
      this.loadHistory();
    }
  }

  private loadHistory(): void {
    if (this.resort !== 'wdw' || !this.parkId) {
      this.historyRows = [];
      return;
    }

    this.historyLoading = true;
    this.historicalData
      .getParkLlHistory(this.parkId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entries) => {
        this.historyRows = this.buildHistoryRows(entries);
        this.historyLoading = false;
      });
  }

  private buildHistoryRows(entries: ParkLlDailySnapshot[]): ParkLlHistoryRow[] {
    return entries.map((entry) => ({
      localDate: entry.localDate,
      dateLabel: formatIllLocalDate(entry.localDate),
      multiPass: formatOptionalIllPriceCents(entry.multiPassCents),
      multiPassSoldOut: entry.multiPassSoldOut,
      premierPass: formatOptionalIllPriceCents(entry.premierPassCents),
      premierPassSoldOut: entry.premierPassSoldOut,
    }));
  }
}