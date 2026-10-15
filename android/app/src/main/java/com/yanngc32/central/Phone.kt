package com.yanngc32.central

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.CancellationSignal
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Celular como sensor: manda bateria, carregando e (se tiver permissão) a localização para a central,
 * que mantém o aparelho "Celular" deste acesso. Ao abrir o app e a cada ~15 min em segundo plano.
 */
object Phone {
    private const val WORK = "phone_report"
    // Local mais velho que isto não vale: a central trata o que recebe como "agora".
    private const val MAX_FIX_AGE_MS = 10 * 60 * 1000L
    private const val FIX_TIMEOUT_S = 20L

    fun schedule(ctx: Context) {
        val request = PeriodicWorkRequestBuilder<ReportWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun hasLocation(ctx: Context) =
        ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Envia agora (bloqueia: chamar fora da thread principal). Sem pareamento, AuthError. */
    fun report(ctx: Context) {
        val body = JSONObject()
        val battery = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val pct = if (level >= 0 && scale > 0) level * 100 / scale
        else (ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager)
            .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        body.put("battery", pct.coerceIn(0, 100))
        body.put("charging", (battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0)
        location(ctx)?.let {
            body.put("lat", it.latitude).put("lon", it.longitude)
            if (it.hasAccuracy()) body.put("accuracy_m", it.accuracy.toDouble())
        }
        Central.phoneReport(ctx, body.toString())
    }

    /** Posição atual (ou uma recente); null sem permissão, com o local desligado ou sem fix. */
    @SuppressLint("MissingPermission")
    private fun location(ctx: Context): Location? {
        if (!hasLocation(ctx)) return null
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = lm.getProviders(true)
        if (providers.isEmpty()) return null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val provider = when {
                "fused" in providers -> "fused" // FUSED_PROVIDER: constante só da API 31
                LocationManager.GPS_PROVIDER in providers -> LocationManager.GPS_PROVIDER
                else -> providers.first()
            }
            val latch = CountDownLatch(1)
            var fix: Location? = null
            val cancel = CancellationSignal()
            try {
                lm.getCurrentLocation(provider, cancel, ctx.mainExecutor) { fix = it; latch.countDown() }
                if (!latch.await(FIX_TIMEOUT_S, TimeUnit.SECONDS)) cancel.cancel()
            } catch (e: Exception) {
                cancel.cancel()
            }
            fix?.let { return it }
        }
        val now = System.currentTimeMillis()
        return providers.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .filter { now - it.time <= MAX_FIX_AGE_MS }
            .maxByOrNull { it.time }
    }
}

class ReportWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result = try {
        Phone.report(applicationContext)
        Result.success()
    } catch (e: AuthError) {
        Result.success() // não pareado: nada a fazer até abrir o app
    } catch (e: Exception) {
        Result.retry()
    }
}
