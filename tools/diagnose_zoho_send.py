from pathlib import Path

path = Path("deck-fence-quote-api.js")
text = path.read_text(encoding="utf-8")

old_send = '''  const result = await response.json().catch(() => ({}));
  const zohoStatus = Number(result?.status?.code || 0);

  if (!response.ok || (zohoStatus && zohoStatus >= 300)) {
    throw new Error(`Zoho send failed: ${result?.status?.description || response.status}`);
  }

  return result;'''

new_send = '''  const result = await response.json().catch(() => ({}));
  const zohoStatus = Number(result?.status?.code || 0);
  const messageId = clean(result?.data?.messageId || "", 200);
  const description = clean(result?.status?.description || "", 500);
  const moreInfo = clean(result?.data?.moreInfo || "", 500);

  if (!response.ok || zohoStatus !== 200 || !messageId) {
    throw new Error(
      `Zoho send failed: HTTP ${response.status}; API ${zohoStatus || "missing"}; ${description || moreInfo || "missing messageId"}`,
    );
  }

  return result;'''

old_catch = '''  } catch (error) {
    console.error("Deck/fence quote Zoho email failed", error);
    return json({ ok: false, error: "We could not send your request. Please call 403-479-3905." }, 502);
  }'''

new_catch = '''  } catch (error) {
    console.error("Deck/fence quote Zoho email failed", error);
    const diagnostic = error instanceof Error ? error.message : String(error);
    return json({
      ok: false,
      error: isPreviewRequest(request)
        ? diagnostic
        : "We could not send your request. Please call 403-479-3905.",
    }, 502);
  }'''

if old_send not in text:
    raise SystemExit("Expected Zoho send block was not found")
if old_catch not in text:
    raise SystemExit("Expected Zoho catch block was not found")

text = text.replace(old_send, new_send, 1).replace(old_catch, new_catch, 1)
path.write_text(text, encoding="utf-8")
print("Zoho send validation and Preview diagnostics updated")
