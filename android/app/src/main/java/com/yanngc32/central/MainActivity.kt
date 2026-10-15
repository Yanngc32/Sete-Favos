package com.yanngc32.central

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import kotlin.concurrent.thread

/** O painel da central num WebView. O pareamento feito aqui vale também para os widgets. */
class MainActivity : Activity() {
    private companion object {
        const val REQ_LOCATION = 1
        const val REQ_BACKGROUND = 2
        const val REQ_LOCATION_BUTTON = 3
        const val REQ_BACKGROUND_BUTTON = 4
    }

    private lateinit var web: WebView
    private var checkedApp = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Só páginas da central ficam no WebView (shouldOverrideUrlLoading), então só elas veem a ponte.
            addJavascriptInterface(Bridge(), "SeteFavos")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    // Fica dentro do app só o que é da central; links de fora abrem no navegador.
                    val server = Central.server(this@MainActivity) ?: return false
                    if (request.url.toString().startsWith(server)) return false
                    startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, request.url))
                    return true
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) askServer(getString(R.string.sem_conexao))
                }

                override fun onPageFinished(view: WebView, url: String) {
                    CookieManager.getInstance().flush() // widgets leem o cookie do pareamento
                    DeviceWidget.refreshAll(this@MainActivity)
                    if (!checkedApp) {
                        checkedApp = true
                        checkAppUpdate()
                        startPhone()
                    }
                }
            }
        }
        CookieManager.getInstance().setAcceptCookie(true)
        setContentView(FrameLayout(this).apply {
            addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        })
        val server = Central.server(this)
        if (server == null) askServer(null) else web.loadUrl(server)
    }

    /** A central traz o APK da mesma versão dela: se for mais novo que este, oferece (uma vez por versão). */
    private fun checkAppUpdate() {
        val installed = packageManager.getPackageInfo(packageName, 0).versionName ?: return
        thread {
            val offered = try { Central.offeredApp(this) } catch (e: Exception) { null } ?: return@thread
            val prefs = getSharedPreferences("central", 0)
            if (!Central.newer(offered, installed) || prefs.getString("skip_app", null) == offered) return@thread
            runOnUiThread {
                AlertDialog.Builder(this)
                    .setTitle(R.string.app_novo_titulo)
                    .setMessage(getString(R.string.app_novo_texto, offered, installed))
                    .setPositiveButton(R.string.atualizar) { _, _ ->
                        val url = Central.server(this) + "/app/central.apk"
                        startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)))
                    }
                    .setNegativeButton(R.string.agora_nao) { _, _ -> prefs.edit().putString("skip_app", offered).apply() }
                    .show()
            }
        }
    }

    /** Celular como sensor: agenda o envio periódico, manda agora e, já pareado, pede a localização (uma vez). */
    private fun startPhone() {
        Phone.schedule(this)
        thread {
            val paired = try { Phone.report(this); true } catch (e: Exception) { false }
            if (paired) runOnUiThread { askLocation() }
        }
    }

    /** "none", "foreground" (só com o app aberto) ou "always". */
    private fun locationStatus(): String = when {
        !Phone.hasLocation(this) -> "none"
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED -> "foreground"
        else -> "always"
    }

    /** Ao abrir já pareado: pergunta uma vez só; depois, o botão do painel (requestLocation) pede de novo. */
    private fun askLocation() {
        val prefs = getSharedPreferences("central", 0)
        val key = if (locationStatus() == "none") "asked_location" else "asked_background"
        if (locationStatus() == "always" || prefs.getBoolean(key, false)) return
        prefs.edit().putBoolean(key, true).apply()
        requestLocation(fromButton = false)
    }

    /** Explica e pede o próximo passo que falta (local; depois "o tempo todo", Android 10+). */
    private fun requestLocation(fromButton: Boolean) {
        val background = when (locationStatus()) {
            "none" -> false
            "foreground" -> true
            else -> return
        }
        val perms = if (background) arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        val code = when {
            background -> if (fromButton) REQ_BACKGROUND_BUTTON else REQ_BACKGROUND
            else -> if (fromButton) REQ_LOCATION_BUTTON else REQ_LOCATION
        }
        AlertDialog.Builder(this)
            .setTitle(if (background) R.string.local_fundo_titulo else R.string.local_titulo)
            .setMessage(if (background) R.string.local_fundo_texto else R.string.local_texto)
            .setPositiveButton(R.string.permitir) { _, _ -> requestPermissions(perms, code) }
            .setNegativeButton(R.string.agora_nao, null)
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        notifyLocation()
        val fromButton = requestCode == REQ_LOCATION_BUTTON || requestCode == REQ_BACKGROUND_BUTTON
        if (grantResults.none { it == PackageManager.PERMISSION_GRANTED }) {
            // Pelo botão e negado de vez (o Android nem mostra mais o pedido): só nas configurações do app.
            if (fromButton && permissions.none { shouldShowRequestPermissionRationale(it) }) openAppSettings()
            return
        }
        thread { try { Phone.report(this) } catch (e: Exception) { } }
        if (requestCode == REQ_LOCATION || requestCode == REQ_LOCATION_BUTTON) requestLocation(fromButton)
    }

    private fun openAppSettings() {
        startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            android.net.Uri.fromParts("package", packageName, null)))
    }

    /** Avisa o painel que a permissão pode ter mudado (atualiza o botão). */
    private fun notifyLocation() {
        web.evaluateJavascript("window.dispatchEvent(new Event('sete-favos-location'))", null)
    }

    /** Ponte para o painel: window.SeteFavos.locationStatus() / requestLocation(). */
    private inner class Bridge {
        @JavascriptInterface
        fun locationStatus(): String = this@MainActivity.locationStatus()

        @JavascriptInterface
        fun requestLocation() {
            runOnUiThread { requestLocation(fromButton = true) }
        }
    }

    override fun onRestart() {
        super.onRestart()
        // Voltou para o app (talvez das configurações): notícia nova e botão atualizado.
        notifyLocation()
        thread { try { Phone.report(this) } catch (e: Exception) { } }
    }

    private fun askServer(problem: String?) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            hint = getString(R.string.endereco_dica)
            setText(Central.server(this@MainActivity) ?: "")
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.endereco_titulo)
            .setMessage(problem ?: getString(R.string.endereco_texto))
            .setView(input)
            .setCancelable(false)
            .setPositiveButton(R.string.conectar) { _, _ ->
                var url = input.text.toString().trim()
                if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://$url"
                Central.setServer(this, url)
                web.loadUrl(url)
            }
            .apply { if (Central.server(this@MainActivity) != null) setNegativeButton(R.string.tentar_de_novo) { _, _ -> web.reload() } }
            .show()
    }

    @Deprecated("Activity sem AndroidX")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
