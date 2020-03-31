import { LinkedList } from "x3-linkedlist";
import { Database } from "./database";
import { Dict } from "./util/types";

export class ArrayCursor<T = any> {
  protected _db: Database;
  protected _result: T[];
  protected _count?: number;
  protected _extra: {
    warnings: { code: number; message: string }[];
    plan?: any;
    profile?: any;
    stats?: Dict<any>;
  };
  protected _hasMore: boolean;
  protected _id: string | undefined;
  protected _host?: number;
  protected _allowDirtyRead?: boolean;

  /** @hidden */
  constructor(
    db: Database,
    body: {
      extra: any;
      result: T[];
      hasMore: boolean;
      id: string;
      count: number;
    },
    host?: number,
    allowDirtyRead?: boolean
  ) {
    this._db = db;
    this._result = body.result;
    this._id = body.id;
    this._hasMore = Boolean(body.id && body.hasMore);
    this._host = host;
    this._count = body.count;
    this._extra = body.extra;
    this._allowDirtyRead = allowDirtyRead;
  }

  protected async _drain(): Promise<ArrayCursor<T>> {
    await this._more();
    if (!this.hasMore) return this;
    return this._drain();
  }

  protected async _more(): Promise<void> {
    if (!this.hasMore) return;
    const res = await this._db.request({
      method: "PUT",
      path: `/_api/cursor/${this._id}`,
      host: this._host,
      allowDirtyRead: this._allowDirtyRead
    });
    this._result.push(...res.body.result);
    this._hasMore = res.body.hasMore;
  }

  get extra() {
    return this._extra;
  }

  get count() {
    return this._count;
  }

  get hasMore(): boolean {
    return this._hasMore;
  }

  get hasNext(): boolean {
    return this.hasMore || Boolean(this._result.length);
  }

  async all(): Promise<T[]> {
    await this._drain();
    let result = this._result;
    this._result = [];
    return result;
  }

  async next(): Promise<T | undefined> {
    while (!this._result.length && this.hasMore) {
      await this._more();
    }
    if (!this._result.length) {
      return undefined;
    }
    return this._result.shift();
  }

  async nextBatch(): Promise<any[] | undefined> {
    while (!this._result.length && this.hasMore) {
      await this._more();
    }
    if (!this._result.length) {
      return undefined;
    }
    return this._result.splice(0, this._result.length);
  }

  async each(
    fn: (value: T, index: number, self: ArrayCursor<T>) => boolean | void
  ): Promise<boolean> {
    let index = 0;
    while (this._result.length || this.hasMore) {
      let result;
      while (this._result.length) {
        result = fn(this._result.shift()!, index, this);
        index++;
        if (result === false) return result;
      }
      if (this.hasMore) await this._more();
    }
    return true;
  }

  async every(
    fn: (value: T, index: number, self: ArrayCursor<T>) => boolean
  ): Promise<boolean> {
    let index = 0;
    while (this._result.length || this.hasMore) {
      let result;
      while (this._result.length) {
        result = fn(this._result.shift()!, index, this);
        index++;
        if (!result) return false;
      }
      if (this.hasMore) await this._more();
    }
    return true;
  }

  async some(
    fn: (value: T, index: number, self: ArrayCursor<T>) => boolean
  ): Promise<boolean> {
    let index = 0;
    while (this._result.length || this.hasMore) {
      let result;
      while (this._result.length) {
        result = fn(this._result.shift()!, index, this);
        index++;
        if (result) return true;
      }
      if (this.hasMore) await this._more();
    }
    return false;
  }

  async map<U = any>(
    fn: (value: T, index: number, self: ArrayCursor<T>) => U
  ): Promise<U[]> {
    let index = 0;
    let result: any[] = [];
    while (this._result.length || this.hasMore) {
      while (this._result.length) {
        result.push(fn(this._result.shift()!, index, this));
        index++;
      }
      if (this.hasMore) await this._more();
    }
    return result;
  }

  async reduce<U>(
    fn: (accu: U, value: T, index: number, self: ArrayCursor<T>) => U,
    accu?: U
  ): Promise<U | undefined> {
    let index = 0;
    if (!this._result.length) return accu;
    if (accu === undefined) {
      if (!this._result.length && !this.hasMore) {
        await this._more();
      }
      accu = this._result.shift() as any;
      index += 1;
    }
    while (this._result.length || this.hasMore) {
      while (this._result.length) {
        accu = fn(accu!, this._result.shift()!, index, this);
        index++;
      }
      if (this.hasMore) await this._more();
    }
    return accu;
  }

  async kill(): Promise<void> {
    if (!this.hasMore) return undefined;
    return this._db.request(
      {
        method: "DELETE",
        path: `/_api/cursor/${this._id}`
      },
      () => {
        this._hasMore = false;
        return undefined;
      }
    );
  }
}
