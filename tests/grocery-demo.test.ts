import { describe, expect, it } from "vitest";
import { createDemoGroceryBasket } from "../src/services/grocery-demo.js";

const period = {start: "2030-06-10", end: "2030-06-16"};
describe("fictional grocery documents", () => {
  it("covers all ingredient needs with whole packages and exact monetary totals", () => {
    const result = createDemoGroceryBasket([
      {name: "Flour", amount: "1250", unit: "g"},
      {name: "Water", amount: "600", unit: "ml"},
      {name: "Wrappers", amount: "120", unit: "each"}
    ], period);
    expect(result.basket).toMatchObject({subtotal: "19.45", serviceFee: "2.99", total: "22.44", orderPlaced: false,
      items: [{quantity: 2, purchasedAmount: "2000", surplusAmount: "750"},
        {quantity: 1, purchasedAmount: "1000", surplusAmount: "400"},
        {quantity: 2, purchasedAmount: "120", surplusAmount: "0"}]});
    expect(result.html).toContain("DEMO ONLY");
    expect(result.html).toContain("2030-06-10 through 2030-06-16");
    expect(result.html).toContain("disabled");
    expect(result.html).not.toContain("<form");
  });
  it("uses dimension-compatible sample packages and rounds fractional needs exactly", () => {
    const {basket} = createDemoGroceryBasket([
      {name: "Wrappers", amount: "500.001", unit: "g"},
      {name: "Unlisted herb", amount: "500", unit: "g"}
    ], period);
    expect(basket.items[0]).toMatchObject({unit: "g", packAmount: "500", quantity: 2, surplusAmount: "499.999"});
    expect(basket.items[1]).toMatchObject({quantity: 1, surplusAmount: "0"});
  });
  it("escapes ingredient text in the document", () => {
    const {html} = createDemoGroceryBasket([{name: '<script>alert("test")</script>', amount: "10", unit: "g"}], period);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
