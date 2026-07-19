from pathlib import Path

api_path = Path("deck-fence-quote-api.js")
api_text = api_path.read_text(encoding="utf-8")

old_account = '''  return {
    accountId: String(account.accountId),
    fromAddress: WHITE5_EMAIL,
  };
'''
new_account = '''  const primaryAddress = clean(
    account.primaryEmailAddress || account.mailboxAddress || account.incomingUserName || "",
    320,
  );
  const activeSendAddresses = Array.isArray(account.sendMailDetails)
    ? account.sendMailDetails
        .filter((item) => item?.status !== false && item?.fromAddress)
        .map((item) => clean(item.fromAddress, 320))
        .filter(Boolean)
    : [];
  const target = WHITE5_EMAIL.toLowerCase();
  const preferredWebsiteAddress = activeSendAddresses.find(
    (address) => address.toLowerCase() === "website@white5.ca",
  );
  const distinctPrimary = primaryAddress && primaryAddress.toLowerCase() !== target
    ? primaryAddress
    : "";
  const distinctActive = activeSendAddresses.find(
    (address) => address.toLowerCase() !== target,
  );
  const fromAddress = preferredWebsiteAddress
    || distinctPrimary
    || distinctActive
    || primaryAddress
    || activeSendAddresses[0]
    || WHITE5_EMAIL;

  return {
    accountId: String(account.accountId),
    fromAddress,
    senderMode: fromAddress.toLowerCase() === target ? "self" : "separate",
  };
'''
if old_account not in api_text:
    raise SystemExit("Expected Zoho account return block was not found")
api_text = api_text.replace(old_account, new_account, 1)

old_success = '''    const result = await sendZohoMail(accessToken, account, fields, files);
    return json({ ok: true, messageId: clean(result?.data?.messageId || "", 200) });
'''
new_success = '''    const result = await sendZohoMail(accessToken, account, fields, files);
    return json({
      ok: true,
      messageId: clean(result?.data?.messageId || "", 200),
      senderMode: isPreviewRequest(request) ? account.senderMode : undefined,
    });
'''
if old_success not in api_text:
    raise SystemExit("Expected Zoho success response block was not found")
api_text = api_text.replace(old_success, new_success, 1)
api_path.write_text(api_text, encoding="utf-8")

page_path = Path("deck-fence-quote.html")
page_text = page_path.read_text(encoding="utf-8")
old_status = """        setStatus('Thank you! We received your request and will contact you the same day.', 'success');
"""
new_status = """        const previewDiagnostic = location.hostname.endsWith('.pages.dev')
          ? (result.senderMode === 'self'
              ? ' Zoho used the same sender and recipient address.'
              : ' Zoho used a separate sender address.')
          : '';
        setStatus('Thank you! We received your request and will contact you the same day.' + previewDiagnostic, 'success');
"""
if old_status not in page_text:
    raise SystemExit("Expected quote success message was not found")
page_text = page_text.replace(old_status, new_status, 1)
page_path.write_text(page_text, encoding="utf-8")

print("Updated Zoho sender selection and preview diagnostics")
