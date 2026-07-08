import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SortOption } from '../../../../core/models/theme-parks.models';

@Component({
  selector: 'app-filter-toolbar',
  standalone: true,
  imports: [
    FormsModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
  ],
  templateUrl: './filter-toolbar.component.html',
  styleUrl: './filter-toolbar.component.scss',
})
export class FilterToolbarComponent {
  @Input() search = '';
  @Input() sort: SortOption = 'shortest-wait';

  @Output() searchChange = new EventEmitter<string>();
  @Output() sortChange = new EventEmitter<SortOption>();

  get sortIcon(): string {
    return this.sort === 'shortest-wait'
      ? 'pi pi-sort-amount-up'
      : 'pi pi-sort-amount-down';
  }

  get sortLabel(): string {
    return this.sort === 'shortest-wait' ? 'Shortest first' : 'Longest first';
  }

  get sortAriaLabel(): string {
    return this.sort === 'shortest-wait'
      ? 'Sorted by shortest wait. Toggle to sort by longest wait.'
      : 'Sorted by longest wait. Toggle to sort by shortest wait.';
  }

  toggleWaitSort(): void {
    this.sortChange.emit(
      this.sort === 'shortest-wait' ? 'longest-wait' : 'shortest-wait'
    );
  }
}