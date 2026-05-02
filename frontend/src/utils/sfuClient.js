import { Device } from "mediasoup-client";

// Thin wrapper around mediasoup-client — owns the Device + transports and
// turns the socket-based protocol into a few async methods.
export class SfuClient {
    constructor(socket) {
        this.socket = socket;
        this.device = new Device();
        this.sendTransport = null;
        this.recvTransport = null;
        this.producers = new Map();  // kind → producer
        this.consumers = new Map();  // consumerId → consumer
    }

    async load() {
        const { rtpCapabilities, error } = await this._request("get-rtp-capabilities");
        if (error) throw new Error(error);
        await this.device.load({ routerRtpCapabilities: rtpCapabilities });
    }

    async createSendTransport() {
        const data = await this._request("create-send-transport");
        if (data.error) throw new Error(data.error);

        this.sendTransport = this.device.createSendTransport(data);

        this.sendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
            this.socket.emit("connect-transport", {
                transportId: this.sendTransport.id,
                dtlsParameters,
            }, (res) => {
                if (res?.error) errback(new Error(res.error));
                else callback();
            });
        });

        this.sendTransport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
            this.socket.emit("produce", { kind, rtpParameters, appData }, (res) => {
                if (res?.error) errback(new Error(res.error));
                else callback({ id: res.producerId });
            });
        });

        return this.sendTransport;
    }

    async createRecvTransport() {
        const data = await this._request("create-recv-transport");
        if (data.error) throw new Error(data.error);

        this.recvTransport = this.device.createRecvTransport(data);

        this.recvTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
            this.socket.emit("connect-transport", {
                transportId: this.recvTransport.id,
                dtlsParameters,
            }, (res) => {
                if (res?.error) errback(new Error(res.error));
                else callback();
            });
        });

        return this.recvTransport;
    }

    async produce(track) {
        if (!this.sendTransport) await this.createSendTransport();

        const options = { track };

        // For video, send three simulcast layers so the SFU can forward
        // whichever quality each receiver can actually handle.
        if (track.kind === 'video') {
            options.encodings = [
                { maxBitrate: 100000, scaleResolutionDownBy: 4 },  // quarter res
                { maxBitrate: 300000, scaleResolutionDownBy: 2 },  // half res
                { maxBitrate: 900000 },                             // full res
            ];
            options.codecOptions = { videoGoogleStartBitrate: 1000 };
        }

        const producer = await this.sendTransport.produce(options);
        this.producers.set(producer.kind, producer);
        return producer;
    }

    async consume(producerId) {
        if (!this.recvTransport) await this.createRecvTransport();

        const data = await this._request("consume", {
            producerId,
            rtpCapabilities: this.device.rtpCapabilities,
        });

        if (data.error) {
            console.warn("[SFU] consume failed:", data.error);
            return null;
        }

        const consumer = await this.recvTransport.consume({
            id: data.id,
            producerId: data.producerId,
            kind: data.kind,
            rtpParameters: data.rtpParameters,
        });

        this.consumers.set(consumer.id, consumer);

        // Consumers always start paused server-side; tell the server we're ready.
        this.socket.emit("consumer-resume", { consumerId: consumer.id }, () => {});

        return consumer;
    }

    async getExistingProducers() {
        return this._request("get-producers");
    }

    async replaceTrack(kind, newTrack) {
        const producer = this.producers.get(kind);
        if (producer) {
            await producer.replaceTrack({ track: newTrack });
        }
    }

    closeProducer(kind) {
        const producer = this.producers.get(kind);
        if (producer) {
            producer.close();
            this.producers.delete(kind);
        }
    }

    // spatialLayer: 0 quarter / 1 half / 2 full. Driven by network quality.
    setPreferredLayer(spatialLayer) {
        for (const [consumerId] of this.consumers) {
            this.socket.emit("set-consumer-layers", {
                consumerId,
                spatialLayer,
                temporalLayer: spatialLayer,
            }, () => {});
        }
    }

    close() {
        for (const [, producer] of this.producers) producer.close();
        for (const [, consumer] of this.consumers) consumer.close();
        this.sendTransport?.close();
        this.recvTransport?.close();
        this.producers.clear();
        this.consumers.clear();
    }

    _request(event, data = {}) {
        return new Promise((resolve) => {
            this.socket.emit(event, data, (response) => {
                resolve(response);
            });
        });
    }
}
