interface Window {
    electronAPI?: {
        getTunnelUrl(): Promise<string>;
        getServerPort(): Promise<number>;
        getPublicIp(): Promise<string>;
        getSources: () => Promise<unknown[]>;
        test: () => string;
    };
    SERVER_PORT?: number;
}