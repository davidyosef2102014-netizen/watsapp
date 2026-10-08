package com.birgsol.ai;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView web;
    private boolean _showingWeb = true; // האם חלון-האתר מוצג (לעומת מסך-האופליין)
    private ValueCallback<Uri[]> filePathCallback;
    private static final String URL = "https://davidyosef2102014-netizen.github.io/watsapp/birgsolai.html";
    private static final int FILE_REQ = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // בקשת הרשאות מצלמה/מיקרופון/מיקום (לפיצ'רים: לייב-מצלמה, קול, מפות)
        try {
            requestPermissions(new String[]{
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.READ_CONTACTS,
                Manifest.permission.SEND_SMS
            }, 2001);
        } catch (Exception ignored) {}

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setGeolocationEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUserAgentString(s.getUserAgentString() + " BirgsolApp");
        s.setCacheMode(WebSettings.LOAD_NO_CACHE); // תמיד גרסה טרייה מהאתר — לא מטמון ישן

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, android.webkit.WebResourceRequest r) {
                return handleExternal(r.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) { // תאימות לגרסאות ישנות
                return handleExternal(url);
            }
            // כתובות של אפליקציות חיצוניות (וואטסאפ, חייגן, SMS, מייל, מפות, חנות) — פותחים את האפליקציה
            // דרך Intent במקום לנסות לטעון בתוך ה-WebView (מה שגרם ל"האתר לא נמצא").
            private boolean handleExternal(String url) {
                try {
                    String low = url.toLowerCase();
                    boolean ext = low.startsWith("whatsapp:") || low.startsWith("tel:") || low.startsWith("sms:")
                        || low.startsWith("smsto:") || low.startsWith("mailto:") || low.startsWith("geo:")
                        || low.startsWith("market:") || low.startsWith("intent:")
                        || low.contains("wa.me/") || low.contains("api.whatsapp.com") || low.contains("web.whatsapp.com");
                    if (!ext) return false; // כתובת רגילה של האפליקציה — נטען בתוך ה-WebView
                    Intent i = low.startsWith("intent:")
                        ? Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                        : new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try { startActivity(i); }
                    catch (android.content.ActivityNotFoundException nf) {
                        // אין אפליקציה מתאימה — ננסה את wa.me בדפדפן כגיבוי
                        if (low.startsWith("whatsapp:")) {
                            String q = url.contains("?") ? url.substring(url.indexOf('?')) : "";
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + q))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                        }
                    }
                    return true; // טופל חיצונית
                } catch (Exception e) { return false; }
            }
            // 📴 תכונה נייטיב: מסך-אופליין עם כפתור "נסה שוב" כשאין אינטרנט בטעינת הדף הראשי
            @Override public void onReceivedError(WebView v, android.webkit.WebResourceRequest req, android.webkit.WebResourceError err) {
                if (req != null && req.isForMainFrame()) runOnUiThread(() -> showOfflineScreen());
            }
            // כשהדף נטען בהצלחה — מוודאים שחלון-האתר מוצג (ולא מסך-האופליין)
            @Override public void onPageFinished(WebView v, String url) {
                runOnUiThread(() -> { if (!_showingWeb) { _showingWeb = true; setContentView(web); } });
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // מצלמה/מיקרופון
            @Override public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
            // מיקום
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
            // בחירת קובץ (העלאת תמונה/וידאו/אודיו)
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                filePathCallback = cb;
                try {
                    Intent i = params.createIntent();
                    startActivityForResult(i, FILE_REQ);
                } catch (Exception e) { filePathCallback = null; return false; }
                return true;
            }
        });

        // גשר אנשי-קשר: נותן ל-BIRGSOL גישה לאנשי הקשר של הטלפון (אחרי אישור ההרשאה). נחשף כ-window.BIRGSOL_CONTACTS.
        web.addJavascriptInterface(new ContactsBridge(), "BIRGSOL_CONTACTS");
        web.addJavascriptInterface(new SmsBridge(), "BIRGSOL_SMS");

        setContentView(web);
        if (savedInstanceState == null) web.loadUrl(URL + "?t=" + System.currentTimeMillis()); // cache-bust — גרסה אחרונה בכל פתיחה
    }

    // 📴 מסך-אופליין נייטיב עם כפתור "נסה שוב" — תכונה נייטיב אמיתית (לא webview-מעטפת)
    private void showOfflineScreen() {
        _showingWeb = false;
        android.widget.LinearLayout ly = new android.widget.LinearLayout(this);
        ly.setOrientation(android.widget.LinearLayout.VERTICAL);
        ly.setGravity(android.view.Gravity.CENTER);
        ly.setBackgroundColor(0xFF0B0F14);
        ly.setPadding(70, 70, 70, 70);
        android.widget.TextView t = new android.widget.TextView(this);
        t.setText("אין חיבור לאינטרנט");
        t.setTextColor(0xFFFFFFFF); t.setTextSize(21); t.setGravity(android.view.Gravity.CENTER);
        android.widget.TextView t2 = new android.widget.TextView(this);
        t2.setText("בדוק את החיבור שלך ונסה שוב");
        t2.setTextColor(0xFF9AA6B2); t2.setTextSize(14); t2.setGravity(android.view.Gravity.CENTER);
        t2.setPadding(0, 18, 0, 34);
        android.widget.Button b = new android.widget.Button(this);
        b.setText("נסה שוב");
        b.setOnClickListener(view -> { _showingWeb = true; setContentView(web); web.reload(); });
        ly.addView(t); ly.addView(t2); ly.addView(b);
        setContentView(ly);
    }

    // ── גשר אנשי-קשר נייטיב: getAll() מחזיר JSON [{name, number}] מכל אנשי הקשר בטלפון ──
    public class ContactsBridge {
        @JavascriptInterface
        public String getAll() {
            try {
                if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return "[]";
                org.json.JSONArray arr = new org.json.JSONArray();
                android.database.Cursor c = getContentResolver().query(
                        android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        new String[]{
                                android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                                android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER
                        }, null, null, null);
                if (c != null) {
                    int ni = c.getColumnIndex(android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                    int pi = c.getColumnIndex(android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER);
                    while (c.moveToNext()) {
                        String nm = ni >= 0 ? c.getString(ni) : null;
                        String ph = pi >= 0 ? c.getString(pi) : null;
                        if (nm != null && ph != null) {
                            org.json.JSONObject o = new org.json.JSONObject();
                            o.put("name", nm); o.put("number", ph);
                            arr.put(o);
                        }
                    }
                    c.close();
                }
                return arr.toString();
            } catch (Exception e) { return "[]"; }
        }
        @JavascriptInterface
        public boolean available() { return true; }
    }

    // ── גשר SMS נייטיב: send(number,text) שולח SMS בשקט, בתוך האפליקציה, בלי לצאת ──
    public class SmsBridge {
        @JavascriptInterface
        public String send(String number, String text) {
            try {
                if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
                    try { requestPermissions(new String[]{ Manifest.permission.SEND_SMS }, 2002); } catch (Exception ignored) {}
                    return "no-perm";
                }
                if (number == null || number.trim().isEmpty() || text == null) return "err:bad-args";
                android.telephony.SmsManager sm;
                if (android.os.Build.VERSION.SDK_INT >= 31) sm = getSystemService(android.telephony.SmsManager.class);
                else sm = android.telephony.SmsManager.getDefault();
                java.util.ArrayList<String> parts = sm.divideMessage(text);
                sm.sendMultipartTextMessage(number.trim(), null, parts, null, null);
                return "sent";
            } catch (Exception e) { return "err:" + e.getMessage(); }
        }
        @JavascriptInterface
        public boolean available() { return true; }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQ) {
            if (filePathCallback != null) {
                Uri[] result = (resultCode == Activity.RESULT_OK && data != null && data.getData() != null)
                        ? new Uri[]{ data.getData() } : null;
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
