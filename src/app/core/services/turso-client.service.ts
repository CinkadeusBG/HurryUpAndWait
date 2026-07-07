import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  TURSO_AUTH_TOKEN,
  TURSO_DATABASE_URL,
} from '../constants/park.constants';

type TursoCell = { type: string; value?: string };
type TursoColumn = { name: string };
type TursoExecuteResult = {
  cols: TursoColumn[];
  rows: TursoCell[][];
};
type TursoPipelineResponse = {
  results: Array<{
    type: string;
    response?: {
      type: string;
      result?: TursoExecuteResult;
    };
  }>;
};

export type TursoRow = Record<string, string | number | null>;

type TursoArg =
  | { type: 'null' }
  | { type: 'integer'; value: string }
  | { type: 'float'; value: string }
  | { type: 'text'; value: string };

@Injectable({ providedIn: 'root' })
export class TursoClientService {
  private readonly http = inject(HttpClient);
  private readonly pipelineUrl = this.toPipelineUrl(TURSO_DATABASE_URL);

  async query(sql: string, args: Array<string | number | null> = []): Promise<TursoRow[]> {
    const stmt: { sql: string; args?: TursoArg[] } = { sql };
    if (args.length) {
      stmt.args = args.map((arg) => this.encodeArg(arg));
    }

    const body = {
      requests: [{ type: 'execute', stmt }],
    };

    const response = await firstValueFrom(
      this.http.post<TursoPipelineResponse>(this.pipelineUrl, body, {
        headers: {
          Authorization: `Bearer ${TURSO_AUTH_TOKEN}`,
        },
      })
    );

    const result = response.results[0]?.response?.result;
    if (!result) {
      return [];
    }

    return result.rows.map((cells) => {
      const row: TursoRow = {};
      result.cols.forEach((column, index) => {
        const cell = cells[index];
        row[column.name] = this.parseCell(cell);
      });
      return row;
    });
  }

  private toPipelineUrl(databaseUrl: string): string {
    const normalized = databaseUrl.replace(/^libsql:\/\//, 'https://');
    return `${normalized}/v2/pipeline`;
  }

  private encodeArg(arg: string | number | null): TursoArg {
    if (arg === null) {
      return { type: 'null' };
    }

    if (typeof arg === 'number') {
      return Number.isInteger(arg)
        ? { type: 'integer', value: String(arg) }
        : { type: 'float', value: String(arg) };
    }

    return { type: 'text', value: arg };
  }

  private parseCell(cell: TursoCell | undefined): string | number | null {
    if (!cell || cell.type === 'null') {
      return null;
    }

    if (cell.type === 'integer') {
      return Number(cell.value);
    }

    return cell.value ?? null;
  }
}