import "dotenv/config";

async function main() {
  const eoa = "0xec32908599F9F57cf78F83fc9ED42ef2f6070c3a";
  console.log("Getting bridge deposit address for:", eoa);

  const res = await fetch("https://bridge.polymarket.com/deposit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: eoa }),
  });

  console.log("Status:", res.status);
  const json = await res.json() as any;
  console.log(JSON.stringify(json, null, 2));

  if (json?.address?.evm) {
    console.log("\n=== YOUR BRIDGE DEPOSIT ADDRESS ===");
    console.log("Send USDC (native or USDC.e) on Polygon to:");
    console.log(json.address.evm);
    console.log("\nThis is the address that credits YOUR Polymarket CLOB account.");
    console.log("Sending to any other address will NOT credit your account.");
  }
}

main().catch(console.error);
