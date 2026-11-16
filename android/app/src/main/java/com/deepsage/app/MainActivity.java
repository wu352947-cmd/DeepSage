package com.deepsage.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Arrays;

public class MainActivity extends BridgeActivity {

    private ActivityResultLauncher<Intent> documentPickerLauncher;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        documentPickerLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            (result) -> {
                ValueCallback<Uri[]> callback = pendingFileCallback;
                pendingFileCallback = null;
                if (callback == null) {
                    return;
                }
                Uri[] uris = null;
                Intent data = result.getData();
                if (result.getResultCode() == Activity.RESULT_OK && data != null) {
                    ClipData clip = data.getClipData();
                    if (clip != null && clip.getItemCount() > 0) {
                        uris = new Uri[clip.getItemCount()];
                        for (int i = 0; i < clip.getItemCount(); i++) {
                            uris[i] = clip.getItemAt(i).getUri();
                        }
                    } else if (data.getData() != null) {
                        uris = new Uri[] { data.getData() };
                    }
                }
                callback.onReceiveValue(uris);
            }
        );

        super.onCreate(savedInstanceState);

        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            webView.addJavascriptInterface(new DeepSageJsBridge(), "DeepSageNative");
            webView.setWebChromeClient(new DeepSageWebChromeClient(bridge));
            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {
                        // Ignore when no handler available
                    }
                }
            });
        }
    }

    private class DeepSageWebChromeClient extends BridgeWebChromeClient {

        DeepSageWebChromeClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            if (
                Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
                ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
            ) {
                runOnUiThread(() -> request.grant(request.getResources()));
                return;
            }
            super.onPermissionRequest(request);
        }

        @Override
        public boolean onShowFileChooser(
            WebView webView,
            ValueCallback<Uri[]> filePathCallback,
            FileChooserParams fileChooserParams
        ) {
            if (pendingFileCallback != null) {
                pendingFileCallback.onReceiveValue(null);
            }
            pendingFileCallback = filePathCallback;

            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            if (fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                documentPickerLauncher.launch(intent);
                return true;
            } catch (Exception ex) {
                pendingFileCallback = null;
                filePathCallback.onReceiveValue(null);
                return false;
            }
        }
    }

    private static String sanitizeFilename(String filename) {
        if (filename == null || filename.trim().isEmpty()) {
            return "deepsage-file";
        }
        return filename.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "_");
    }

    private static String resolveMimeType(String filename, String fallbackMime) {
        if (fallbackMime != null && !fallbackMime.isEmpty() && !"application/octet-stream".equals(fallbackMime)) {
            return fallbackMime;
        }
        int dot = filename.lastIndexOf('.');
        if (dot >= 0 && dot + 1 < filename.length()) {
            String ext = filename.substring(dot + 1).toLowerCase();
            String guessed = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (guessed != null && !guessed.isEmpty()) {
                return guessed;
            }
        }
        return (fallbackMime == null || fallbackMime.isEmpty()) ? "application/octet-stream" : fallbackMime;
    }

    private class DeepSageJsBridge {

        @JavascriptInterface
        public boolean hasRecordAudioPermission() {
            return ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public String saveBase64File(String base64Data, String filename, String mimeType) {
            try {
                String safeName = sanitizeFilename(filename);
                String resolvedMime = resolveMimeType(safeName, mimeType);
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, resolvedMime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    ContentResolver resolver = getContentResolver();
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) {
                        return "ERROR:Unable to create download entry";
                    }
                    try (OutputStream out = resolver.openOutputStream(uri)) {
                        if (out == null) {
                            return "ERROR:Unable to open output stream";
                        }
                        out.write(bytes);
                    }
                    return "Download/" + safeName;
                }

                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) {
                    dir = getFilesDir();
                }
                if (!dir.exists() && !dir.mkdirs()) {
                    return "ERROR:Unable to create downloads directory";
                }
                File target = new File(dir, safeName);
                try (FileOutputStream fos = new FileOutputStream(target)) {
                    fos.write(bytes);
                }
                return target.getAbsolutePath();
            } catch (Exception ex) {
                return "ERROR:" + (ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName());
            }
        }

        @JavascriptInterface
        public String openBase64File(String base64Data, String filename, String mimeType) {
            try {
                String safeName = sanitizeFilename(filename);
                String resolvedMime = resolveMimeType(safeName, mimeType);
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

                File previewDir = new File(getCacheDir(), "preview");
                if (!previewDir.exists() && !previewDir.mkdirs()) {
                    return "ERROR:Unable to create cache directory";
                }
                File outFile = new File(previewDir, safeName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                }

                Uri contentUri = FileProvider.getUriForFile(
                    MainActivity.this,
                    getPackageName() + ".fileprovider",
                    outFile
                );
                Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                viewIntent.setDataAndType(contentUri, resolvedMime);
                viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(viewIntent, safeName);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(chooser);
                return "OK";
            } catch (Exception ex) {
                return "ERROR:" + (ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName());
            }
        }

        @JavascriptInterface
        public void setSystemBarTheme(final boolean dark) {
            runOnUiThread(() -> {
                Window window = getWindow();
                int bgColor = Color.parseColor(dark ? "#151517" : "#FFFFFF");
                window.getDecorView().setBackgroundColor(bgColor);
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                    window,
                    window.getDecorView()
                );
                controller.setAppearanceLightStatusBars(!dark);
                controller.setAppearanceLightNavigationBars(!dark);
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                    window.setStatusBarColor(bgColor);
                    window.setNavigationBarColor(bgColor);
                }
            });
        }
    }
}
