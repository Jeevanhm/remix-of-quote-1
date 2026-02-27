import { useState, useMemo, useEffect } from "react";
import { priceSheet as defaultPriceSheet, categories as defaultCategories, PriceItem } from "@/data/priceSheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, FileDown, Search, Settings, X, Pencil } from "lucide-react";
import { generateQuotePDF } from "./generateQuotePDF";
import { toast } from "sonner";
import msLogo from "@/assets/mount-sinai-logo.jpg";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface QuoteLineItem {
  id: string;
  resource: string;
  type: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  notes: string;
}

export interface QuoteInfo {
  quotationNumber: string;
  application: string;
  quoteFrom: string;
  issuer: string;
  date: string;
  validUntil: string;
  attention: string;
  projectFund: string;
  numberOfMonths: string;
}

function peekQuotationNumber(): string {
  const current = parseInt(localStorage.getItem("quotationCounter") || "0", 10);
  return (current + 1).toString().padStart(5, "0");
}

function incrementQuotationNumber(): string {
  const key = "quotationCounter";
  const current = parseInt(localStorage.getItem(key) || "0", 10);
  const next = current + 1;
  localStorage.setItem(key, next.toString());
  return next.toString().padStart(5, "0");
}

function formatDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function getValidUntil(dateStr: string): string {
  try {
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + 60);
        return formatDate(d);
      }
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() + 60);
      return formatDate(d);
    }
  } catch {}
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return formatDate(d);
}

function loadCatalog(): PriceItem[] {
  try {
    const stored = localStorage.getItem("priceCatalog");
    if (stored) return JSON.parse(stored);
  } catch {}
  return defaultPriceSheet;
}

function saveCatalog(items: PriceItem[]) {
  localStorage.setItem("priceCatalog", JSON.stringify(items));
}

const QuoteBuilder = () => {
  const [catalog, setCatalog] = useState<PriceItem[]>(loadCatalog);
  const [lineItems, setLineItems] = useState<QuoteLineItem[]>([]);
  const now = formatDate(new Date());
  const [quoteInfo, setQuoteInfo] = useState<QuoteInfo>(() => ({
    quotationNumber: peekQuotationNumber(),
    application: "",
    quoteFrom: "",
    issuer: "Cloud Architect & Engineering",
    date: now,
    validUntil: getValidUntil(now),
    attention: "",
    projectFund: "",
    numberOfMonths: "12",
  }));

  // Catalog management state
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PriceItem | null>(null);
  const [newItem, setNewItem] = useState<PriceItem>({ item: "", unitPrice: 0, category: "" });
  const [catalogSearch, setCatalogSearch] = useState("");

  const catalogCategories = useMemo(() => [...new Set(catalog.map((p) => p.category))].sort(), [catalog]);

  useEffect(() => {
    saveCatalog(catalog);
  }, [catalog]);

  // Update validUntil when date changes
  const updateDate = (dateStr: string) => {
    setQuoteInfo((p) => ({ ...p, date: dateStr, validUntil: getValidUntil(dateStr) }));
  };

  // Item picker state
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const filteredItems = useMemo(() => {
    return catalog.filter((item) => {
      const matchesSearch = item.item.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [searchTerm, categoryFilter, catalog]);

  const addItem = (item: PriceItem) => {
    const newLineItem: QuoteLineItem = {
      id: crypto.randomUUID(),
      resource: "",
      type: item.category,
      itemName: item.item,
      qty: 1,
      unitPrice: item.unitPrice,
      notes: "",
    };
    setLineItems((prev) => [...prev, newLineItem]);
    toast.success(`Added: ${item.item}`);
  };

  const updateLineItem = (id: string, field: keyof QuoteLineItem, value: string | number) => {
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const removeLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Catalog CRUD
  const addCatalogItem = () => {
    if (!newItem.item.trim() || !newItem.category.trim()) {
      toast.error("Item name and category are required.");
      return;
    }
    if (catalog.some((c) => c.item === newItem.item.trim())) {
      toast.error("An item with this name already exists.");
      return;
    }
    setCatalog((prev) => [...prev, { ...newItem, item: newItem.item.trim(), category: newItem.category.trim() }]);
    setNewItem({ item: "", unitPrice: 0, category: "" });
    toast.success("Item added to catalog.");
  };

  const updateCatalogItem = () => {
    if (!editingItem) return;
    setCatalog((prev) => prev.map((c) => (c.item === editingItem.item ? editingItem : c)));
    setEditingItem(null);
    toast.success("Catalog item updated.");
  };

  const deleteCatalogItem = (itemName: string) => {
    setCatalog((prev) => prev.filter((c) => c.item !== itemName));
    toast.success("Item removed from catalog.");
  };

  const resetCatalog = () => {
    setCatalog(defaultPriceSheet);
    localStorage.removeItem("priceCatalog");
    toast.success("Catalog reset to defaults.");
  };

  const filteredCatalogItems = useMemo(() => {
    if (!catalogSearch) return catalog;
    return catalog.filter((c) => c.item.toLowerCase().includes(catalogSearch.toLowerCase()));
  }, [catalog, catalogSearch]);

  const monthlyTotal = lineItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  const months = parseInt(quoteInfo.numberOfMonths) || 12;
  const oneTimeFunding = monthlyTotal * months;

  const handleGeneratePDF = async () => {
    if (lineItems.length === 0) {
      toast.error("Add at least one item to generate a quote.");
      return;
    }
    const currentNumber = incrementQuotationNumber();
    const infoWithNumber = { ...quoteInfo, quotationNumber: currentNumber };
    await generateQuotePDF(lineItems, infoWithNumber);
    // Update displayed number to next preview
    setQuoteInfo((p) => ({ ...p, quotationNumber: peekQuotationNumber() }));
    toast.success("PDF generated successfully!");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src={msLogo} alt="Mount Sinai Health System" className="h-16 w-auto" />
            <div>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Azure and On-Prem Quote Generator</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Build and export cloud infrastructure quotes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Settings className="w-4 h-4" />
                  Manage Catalog
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                  <DialogTitle>Price Catalog Management</DialogTitle>
                </DialogHeader>

                {/* Add new item */}
                <div className="border border-border rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Add New Item</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <Input placeholder="Item name" value={newItem.item} onChange={(e) => setNewItem((p) => ({ ...p, item: e.target.value }))} />
                    <Input placeholder="Category" value={newItem.category} onChange={(e) => setNewItem((p) => ({ ...p, category: e.target.value }))} />
                    <div className="flex gap-2">
                      <Input type="number" placeholder="Unit Price" value={newItem.unitPrice || ""} onChange={(e) => setNewItem((p) => ({ ...p, unitPrice: parseFloat(e.target.value) || 0 }))} />
                      <Button onClick={addCatalogItem} size="sm" className="shrink-0">
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Search & Reset */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="Search catalog..." value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)} className="pl-9" />
                  </div>
                  <Button variant="outline" size="sm" onClick={resetCatalog}>Reset to Defaults</Button>
                </div>

                {/* Catalog list */}
                <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
                  {filteredCatalogItems.map((item) => (
                    <div key={item.item} className="flex items-center gap-2 px-3 py-2 rounded-md border border-border/50 hover:bg-muted/30 text-sm">
                      {editingItem?.item === item.item ? (
                        <>
                          <Input value={editingItem.category} onChange={(e) => setEditingItem((p) => p ? { ...p, category: e.target.value } : p)} className="h-7 text-xs flex-1" />
                          <Input type="number" value={editingItem.unitPrice} onChange={(e) => setEditingItem((p) => p ? { ...p, unitPrice: parseFloat(e.target.value) || 0 } : p)} className="h-7 text-xs w-24" />
                          <Button size="sm" variant="ghost" onClick={updateCatalogItem} className="h-7 px-2 text-xs">Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingItem(null)} className="h-7 px-2 text-xs"><X className="w-3 h-3" /></Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 truncate font-medium text-foreground">{item.item}</span>
                          <span className="text-xs text-muted-foreground w-28 truncate">{item.category}</span>
                          <span className="text-xs font-mono text-primary w-20 text-right">${item.unitPrice.toFixed(2)}</span>
                          <button onClick={() => setEditingItem({ ...item })} className="p-1 rounded hover:bg-accent text-muted-foreground">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteCatalogItem(item.item)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{catalog.length} items in catalog</p>
              </DialogContent>
            </Dialog>

            <Button onClick={handleGeneratePDF} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              <FileDown className="w-4 h-4" />
              Export PDF
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* Left Panel: Item Picker */}
        <aside className="space-y-4">
          <div className="bg-card rounded-lg border border-border p-4 space-y-3 sticky top-[93px]">
            <h2 className="font-semibold text-foreground text-sm uppercase tracking-wider">Price Catalog</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 bg-background"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {catalogCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="max-h-[calc(100vh-320px)] overflow-y-auto space-y-1 pr-1">
              {filteredItems.map((item) => (
                <button
                  key={item.item}
                  onClick={() => addItem(item)}
                  className="w-full text-left px-3 py-2.5 rounded-md hover:bg-accent transition-colors group border border-transparent hover:border-border"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground truncate mr-2">{item.item}</span>
                    <Plus className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">{item.category}</span>
                    <span className="text-xs font-mono text-primary font-medium">${item.unitPrice.toFixed(2)}/mo</span>
                  </div>
                </button>
              ))}
              {filteredItems.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No items found</p>
              )}
            </div>
          </div>
        </aside>

        {/* Right Panel: Quote */}
        <main className="space-y-6">
          {/* Quote Info */}
          <div className="bg-card rounded-lg border border-border p-5">
            <h2 className="font-semibold text-foreground text-sm uppercase tracking-wider mb-4">Quote Details</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Quotation #</label>
                <Input value={quoteInfo.quotationNumber} readOnly className="bg-muted/50 cursor-not-allowed font-mono" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Application</label>
                <Input value={quoteInfo.application} onChange={(e) => setQuoteInfo((p) => ({ ...p, application: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Quote From</label>
                <Input value={quoteInfo.quoteFrom} onChange={(e) => setQuoteInfo((p) => ({ ...p, quoteFrom: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Issuer</label>
                <Input value={quoteInfo.issuer} onChange={(e) => setQuoteInfo((p) => ({ ...p, issuer: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Attention</label>
                <Input value={quoteInfo.attention} onChange={(e) => setQuoteInfo((p) => ({ ...p, attention: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Project Fund #</label>
                <Input value={quoteInfo.projectFund} onChange={(e) => setQuoteInfo((p) => ({ ...p, projectFund: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Number of Months</label>
                <Input type="number" value={quoteInfo.numberOfMonths} onChange={(e) => setQuoteInfo((p) => ({ ...p, numberOfMonths: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Created On</label>
                <Input value={quoteInfo.date} onChange={(e) => updateDate(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Valid Until</label>
                <Input value={quoteInfo.validUntil} readOnly className="bg-muted/50 cursor-not-allowed" />
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-primary text-primary-foreground">
                    <th className="px-3 py-2.5 text-left font-medium">Resource</th>
                    <th className="px-3 py-2.5 text-left font-medium">Type</th>
                    <th className="px-3 py-2.5 text-left font-medium">Item</th>
                    <th className="px-3 py-2.5 text-center font-medium w-20">Qty</th>
                    <th className="px-3 py-2.5 text-right font-medium w-24">Unit $</th>
                    <th className="px-3 py-2.5 text-right font-medium w-28">Monthly $</th>
                    <th className="px-3 py-2.5 text-left font-medium">Notes</th>
                    <th className="px-3 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-muted-foreground">
                        Select items from the catalog to build your quote
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item, idx) => (
                      <tr key={item.id} className={idx % 2 === 0 ? "bg-card" : "bg-muted/30"}>
                        <td className="px-2 py-1.5">
                          <Input
                            value={item.resource}
                            onChange={(e) => updateLineItem(item.id, "resource", e.target.value)}
                            placeholder="Resource name"
                            className="h-8 text-sm border-border/50"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={item.type}
                            onChange={(e) => updateLineItem(item.id, "type", e.target.value)}
                            placeholder="Type"
                            className="h-8 text-sm border-border/50"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-foreground font-medium truncate max-w-[200px]" title={item.itemName}>
                          {item.itemName}
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="number"
                            min={1}
                            value={item.qty}
                            onChange={(e) => updateLineItem(item.id, "qty", parseInt(e.target.value) || 1)}
                            className="h-8 text-sm text-center border-border/50"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-foreground">
                          ${item.unitPrice.toFixed(2)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold text-foreground">
                          ${(item.qty * item.unitPrice).toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={item.notes}
                            onChange={(e) => updateLineItem(item.id, "notes", e.target.value)}
                            placeholder="Notes"
                            className="h-8 text-sm border-border/50"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => removeLineItem(item.id)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary */}
          {lineItems.length > 0 && (
            <div className="bg-card rounded-lg border border-border p-5 max-w-md">
              <h2 className="font-semibold text-foreground text-sm uppercase tracking-wider mb-3">Summary</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monthly Total</span>
                  <span className="font-mono font-semibold text-foreground">${monthlyTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Number of Months</span>
                  <span className="font-mono text-foreground">{months}</span>
                </div>
                <div className="border-t border-border pt-2 flex justify-between">
                  <span className="font-bold text-foreground">1 Time Funding</span>
                  <span className="font-mono font-bold text-primary text-lg">${oneTimeFunding.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default QuoteBuilder;
