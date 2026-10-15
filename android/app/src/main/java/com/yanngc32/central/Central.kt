package com.yanngc32.central

import android.content.Context
import android.webkit.CookieManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Um item do widget: aparelho + o que ele liga (power ou uma tecla do interruptor), ou uma rotina
 * (`routine` = true; `id` é o da rotina e o toque roda a rotina). `kind` escolhe o ícone.
 */
data class Target(
    val id: String,
    val capability: String,
    val label: String,
    val kind: String = "",
    val routine: Boolean = false,
) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("cap", capability).put("label", label)
        .put("kind", kind).put("routine", routine)

    companion object {
        fun fromJson(o: JSONObject) = Target(
            id = o.getString("id"), capability = o.optString("cap", "power"), label = o.optString("label"),
            kind = o.optString("kind"), routine = o.optBoolean("routine", false),
        )
    }
}

data class Routine(val id: String, val name: String)

data class Device(
    val id: String,
    val name: String,
    val kind: String,
    val online: Boolean,
    val state: JSONObject,
    /** Teclas do interruptor (switch_1...) com o nome dado no painel. */
    val keys: List<Pair<String, String>>,
) {
    fun isOn(capability: String) = state.optBoolean(capability, false)
}

class AuthError : Exception("sem acesso")

/** Fala com a central usando o mesmo acesso (cookie) que o painel pareou no WebView. */
object Central {
    private const val PREFS = "central"

    fun server(ctx: Context): String? = ctx.getSharedPreferences(PREFS, 0).getString("server", null)

    fun setServer(ctx: Context, url: String) {
        ctx.getSharedPreferences(PREFS, 0).edit().putString("server", url.trimEnd('/')).apply()
    }

    fun devices(ctx: Context): List<Device> {
        val arr = JSONArray(request(ctx, "GET", "/api/devices", null))
        return (0 until arr.length()).map { parse(arr.getJSONObject(it)) }
    }

    fun routines(ctx: Context): List<Routine> {
        val arr = JSONArray(request(ctx, "GET", "/api/routines", null))
        return (0 until arr.length()).map { arr.getJSONObject(it) }.map { Routine(it.getString("id"), it.optString("name")) }
    }

    fun runRoutine(ctx: Context, id: String) {
        request(ctx, "POST", "/api/routines/$id/run", null)
    }

    /** Versão do APK que a central oferece (null se ela não tem APK). */
    fun offeredApp(ctx: Context): String? {
        val o = JSONObject(request(ctx, "GET", "/api/app", null))
        return if (o.optBoolean("available")) o.optString("version").ifEmpty { null } else null
    }

    /** "1.2.10" > "1.2.9" por partes numéricas. */
    fun newer(candidate: String, current: String): Boolean {
        fun parts(v: String) = v.split(".").map { it.toIntOrNull() ?: 0 }
        val a = parts(candidate)
        val b = parts(current)
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    fun device(ctx: Context, id: String): Device = parse(JSONObject(request(ctx, "GET", "/api/devices/$id", null)))

    fun command(ctx: Context, id: String, capability: String, value: Boolean): Device {
        val body = JSONObject().put("capability", capability).put("value", value).toString()
        return parse(JSONObject(request(ctx, "POST", "/api/devices/$id/command", body)))
    }

    /** Bateria/carregando/local deste celular (POST /api/phone/report). */
    fun phoneReport(ctx: Context, body: String) {
        request(ctx, "POST", "/api/phone/report", body)
    }

    private fun parse(o: JSONObject): Device {
        val caps = o.optJSONArray("capabilities") ?: JSONArray()
        val keys = (0 until caps.length()).map { caps.getJSONObject(it) }
            .filter { Regex("""^switch_\d$""").matches(it.getString("id")) }
            .map { it.getString("id") to it.optString("label", it.getString("id")) }
        return Device(
            id = o.getString("id"), name = o.optString("name"), kind = o.optString("kind"),
            online = o.optBoolean("online", false), state = o.optJSONObject("state") ?: JSONObject(), keys = keys,
        )
    }

    private fun request(ctx: Context, method: String, path: String, body: String?): String {
        val base = server(ctx) ?: throw AuthError()
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 6000
            conn.readTimeout = 8000
            CookieManager.getInstance().getCookie(base)?.let { conn.setRequestProperty("Cookie", it) }
            conn.setRequestProperty("Accept", "application/json")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = conn.responseCode
            if (code == 401 || code == 403) throw AuthError()
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw RuntimeException("HTTP $code")
            return text
        } finally {
            conn.disconnect()
        }
    }
}
