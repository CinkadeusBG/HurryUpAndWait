import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import {
  EntityFilter,
  SortOption,
  WaitRangeFilter,
} from '../../../../core/models/theme-parks.models';

@Component({
  selector: 'app-filter-toolbar',
  standalone: true,
  imports: [
    FormsModule,
    InputTextModule,
    DropdownModule,
    IconFieldModule,
    InputIconModule,
  ],
  templateUrl: './filter-toolbar.component.html',
  styleUrl: './filter-toolbar.component.scss',
})
export class FilterToolbarComponent {
  @Input() search = '';
  @Input() sort: SortOption = 'shortest-wait';
  @Input() entityFilter: EntityFilter = 'all';
  @Input() waitRange: WaitRangeFilter = 'all';

  @Output() searchChange = new EventEmitter<string>();
  @Output() sortChange = new EventEmitter<SortOption>();
  @Output() entityFilterChange = new EventEmitter<EntityFilter>();
  @Output() waitRangeChange = new EventEmitter<WaitRangeFilter>();

  readonly sortOptions = [
    { label: 'Shortest wait', value: 'shortest-wait' as SortOption },
    { label: 'Longest wait', value: 'longest-wait' as SortOption },
    { label: 'Alphabetical', value: 'alphabetical' as SortOption },
    { label: 'By land / area', value: 'area' as SortOption },
    { label: 'By type', value: 'type' as SortOption },
  ];

  readonly entityOptions = [
    { label: 'All', value: 'all' as EntityFilter },
    { label: 'Rides', value: 'rides' as EntityFilter },
    { label: 'Shows', value: 'shows' as EntityFilter },
  ];

  readonly waitRangeOptions = [
    { label: 'Any wait', value: 'all' as WaitRangeFilter },
    { label: 'Under 15 min', value: 'under-15' as WaitRangeFilter },
    { label: '15–30 min', value: '15-30' as WaitRangeFilter },
    { label: '30–60 min', value: '30-60' as WaitRangeFilter },
    { label: 'Over 60 min', value: 'over-60' as WaitRangeFilter },
  ];
}