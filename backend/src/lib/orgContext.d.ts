import { Pool, PoolClient } from 'pg';

export declare function setOrgContext(client: PoolClient, orgId: string): Promise<void>;
export declare function clearOrgContext(client: PoolClient): Promise<void>;
export declare function runWithOrg<T>(pool: Pool, orgId: string, fn: (client: PoolClient) => Promise<T>): Promise<T>;
