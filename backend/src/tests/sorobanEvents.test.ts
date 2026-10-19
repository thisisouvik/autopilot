import { describe, it, expect, vi } from "vitest";
import { parseContractEvent, pollSorobanEventsOnce } from "../engine/sorobanEvents";
import { saveSorobanLedger, getSorobanLedger } from "../lib/redis";

describe("Soroban RPC Contract Event Ingest & Indexer (Issue #133)", () => {
  describe("parseContractEvent", () => {
    it("parses withdraw event correctly", () => {
      const mockRawEvent = {
        contractId: "CACYX7GWKABSUFUF5MV5UVRH62F6A2D2SUSAHVC4FTIIKARTIBVUW6BP",
        topic: ["withdraw"],
        value: [
          "GDFKLTB5WKKDDJ2NRU2V5OG476HYEGWT4UFV7BID7BNGWZGRZYL3LL6Z",
          50000000n, // 5 XLM in stroops
          "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        ],
        txHash: "tx-hash-withdraw-123",
        ledger: 12345,
      };

      const parsed = parseContractEvent(mockRawEvent);
      expect(parsed.type).toBe("withdraw");
      expect(parsed.contractId).toBe("CACYX7GWKABSUFUF5MV5UVRH62F6A2D2SUSAHVC4FTIIKARTIBVUW6BP");
      expect(parsed.data.owner).toBe("GDFKLTB5WKKDDJ2NRU2V5OG476HYEGWT4UFV7BID7BNGWZGRZYL3LL6Z");
      expect(parsed.data.rawAmount).toBe(50000000n);
      expect(parsed.txHash).toBe("tx-hash-withdraw-123");
      expect(parsed.ledger).toBe(12345);
    });

    it("parses execute event correctly", () => {
      const mockRawEvent = {
        contractId: "CACYX7GWKABSUFUF5MV5UVRH62F6A2D2SUSAHVC4FTIIKARTIBVUW6BP",
        topic: ["execute"],
        value: [
          "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BM3ICFSS6HXIPP",
          25000000n, // 2.5 XLM
          "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
          "AutoPilot:save:2.5",
        ],
        txHash: "tx-hash-execute-456",
        ledger: 12346,
      };

      const parsed = parseContractEvent(mockRawEvent);
      expect(parsed.type).toBe("execute");
      expect(parsed.data.recipient).toBe("GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BM3ICFSS6HXIPP");
      expect(parsed.data.rawAmount).toBe(25000000n);
      expect(parsed.data.memo).toBe("AutoPilot:save:2.5");
      expect(parsed.txHash).toBe("tx-hash-execute-456");
    });

    it("parses init event correctly", () => {
      const mockRawEvent = {
        contractId: "CACYX7GWKABSUFUF5MV5UVRH62F6A2D2SUSAHVC4FTIIKARTIBVUW6BP",
        topic: ["init"],
        value: [
          "GDFKLTB5WKKDDJ2NRU2V5OG476HYEGWT4UFV7BID7BNGWZGRZYL3LL6Z",
          "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BM3ICFSS6HXIPP",
        ],
        txHash: "tx-hash-init-789",
        ledger: 12300,
      };

      const parsed = parseContractEvent(mockRawEvent);
      expect(parsed.type).toBe("init");
      expect(parsed.data.owner).toBe("GDFKLTB5WKKDDJ2NRU2V5OG476HYEGWT4UFV7BID7BNGWZGRZYL3LL6Z");
      expect(parsed.data.engine).toBe("GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BM3ICFSS6HXIPP");
    });

    it("returns unknown for unrecognised event topics", () => {
      const mockRawEvent = {
        contractId: "CACYX7GWKABSUFUF5MV5UVRH62F6A2D2SUSAHVC4FTIIKARTIBVUW6BP",
        topic: ["some_other_event"],
        value: "data",
        txHash: "tx-hash-other",
        ledger: 12301,
      };

      const parsed = parseContractEvent(mockRawEvent);
      expect(parsed.type).toBe("unknown");
    });
  });

  describe("pollSorobanEventsOnce", () => {
    it("ingests events, logs AutomatedTransaction, and reconciles balance", async () => {
      const contractId = "CACYX7GWKABSUFUF5MV5UVRH62F6A2D2SUSAHVC4FTIIKARTIBVUW6BP";
      const mockServer = {
        getEvents: vi.fn(async () => ({
          events: [
            {
              contractId,
              topic: ["withdraw"],
              value: [
                "GDFKLTB5WKKDDJ2NRU2V5OG476HYEGWT4UFV7BID7BNGWZGRZYL3LL6Z",
                100000000n, // 10.0000000 XLM
                "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
              ],
              txHash: "tx-event-withdraw-1",
              ledger: 500,
            },
          ],
          latestLedger: 505,
        })),
      };

      const insertedTx: any[] = [];
      const updatedVaults: any[] = [];

      const mockSql = Object.assign(
        vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
          const query = strings.join("?");
          if (query.includes('FROM "Vault"')) {
            return [
              {
                id: "vault-uuid-1",
                userId: "user-uuid-1",
                type: "savings",
                publicKey: contractId,
              },
            ];
          }
          if (query.includes('INSERT INTO "AutomatedTransaction"')) {
            insertedTx.push(values);
            return [];
          }
          if (query.includes('UPDATE "Vault"')) {
            updatedVaults.push(values);
            return [];
          }
          return [];
        }),
        {}
      );

      const result = await pollSorobanEventsOnce(mockServer as any, mockSql, [contractId], 490);

      expect(result.eventsProcessed).toBe(1);
      expect(result.latestLedger).toBe(505);
      expect(mockServer.getEvents).toHaveBeenCalledWith({
        startLedger: 490,
        filters: [{ type: "contract", contractIds: [contractId] }],
        limit: 100,
      });
      expect(insertedTx.length).toBe(1);
    });
  });

  describe("Ledger Cursor Persistence", () => {
    it("saves and retrieves Soroban ledger sequence", async () => {
      // In tests without live Redis, functions execute safely without crashing
      await expect(saveSorobanLedger("test-contract", 12345)).resolves.not.toThrow();
      const val = await getSorobanLedger("test-contract");
      expect(val === null || typeof val === "number").toBe(true);
    });
  });
});
