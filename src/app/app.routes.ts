import { Routes } from '@angular/router';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { RideDetailComponent } from './features/ride-detail/ride-detail.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/info-channel/info-channel.component').then(
        (m) => m.InfoChannelComponent
      ),
  },
  { path: 'ride/:parkId/:attractionId', component: RideDetailComponent },
  { path: '**', redirectTo: '' },
];
