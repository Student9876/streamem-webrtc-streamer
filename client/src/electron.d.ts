interface Window {
    electron?: {
        getSources: () => Promise<unknown[]>;
    };
}