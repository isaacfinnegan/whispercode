package ai.opencode.mobilebridge

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log

class NetworkStateListener(private val context: Context) {
    companion object {
        private const val TAG = "NetworkStateListener"
    }

    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private var callback: ConnectivityManager.NetworkCallback? = null

    fun startMonitoring() {
        if (callback != null) return

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.i(TAG, "Internet connection restored. Triggering pending token syncs.")
                val prefs = SecurePreferencesManager(context)
                prefs.getPendingToken()?.let { pendingToken ->
                    TokenSyncWorker.schedule(context, pendingToken)
                }
            }
        }

        try {
            connectivityManager.registerNetworkCallback(request, callback!!)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register network callback listener", e)
        }
    }

    fun stopMonitoring() {
        callback?.let {
            try {
                connectivityManager.unregisterNetworkCallback(it)
            } catch (_: Exception) {}
            callback = null
        }
    }
}
