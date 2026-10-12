<?php
/**
 * Plugin Name: Costareen ERP key
 * Description: Settings > Costareen ERP - shows the key the ERP uses to read this site (orders, stock, parcel numbers), with Copy and Make a new key.
 * The key itself is the option cz_sync_shared_secret used by cz-sheet-sync.php and the parcel route; this page only shows or replaces it.
 */
if (!defined('ABSPATH')) exit;

add_action('admin_menu', function () {
    add_options_page('Costareen ERP', 'Costareen ERP', 'manage_options', 'cz-erp-key', 'cz_erp_key_page');
});

function cz_erp_key_page() {
    if (!current_user_can('manage_options')) return;
    $made = false;
    if (isset($_POST['cz_erp_new']) && check_admin_referer('cz_erp_new_key')) {
        $raw = random_bytes(32);
        $key = rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');   // 43 letters, digits, - and _
        update_option('cz_sync_shared_secret', $key, false);
        $made = true;
    }
    $key = (string) get_option('cz_sync_shared_secret', '');
    ?>
    <div class="wrap">
      <h1>Costareen ERP</h1>
      <?php if ($made): ?>
        <div class="notice notice-warning"><p><strong>A new key was made. The old one has stopped working.</strong> Copy the new key below and paste it in the ERP now.</p></div>
      <?php endif; ?>
      <p>The ERP uses this key to read this website: website orders, stock, and the parcel numbers of website orders.</p>
      <?php if ($key === ''): ?>
        <p><strong>No key yet.</strong> Press <em>Make a new key</em>.</p>
      <?php else: ?>
        <p>
          <input type="password" id="cz-erp-key" value="<?php echo esc_attr($key); ?>" readonly style="width:420px;max-width:100%;font-family:monospace">
          <button type="button" class="button" onclick="var i=document.getElementById('cz-erp-key');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'Show':'Hide';">Show</button>
          <button type="button" class="button button-primary" onclick="var i=document.getElementById('cz-erp-key');navigator.clipboard.writeText(i.value).then(function(){alert('Key copied. Now paste it in the ERP.');});">Copy</button>
        </p>
      <?php endif; ?>
      <h2>Where to paste it</h2>
      <ol>
        <li>Open the ERP &rarr; <strong>Settings</strong> &rarr; <strong>Connections</strong> &rarr; <strong>Website</strong>.</li>
        <li>In <strong>Website orders&rsquo; parcel numbers</strong>, paste the key and press <strong>Save the key</strong>.</li>
      </ol>
      <h2>Make a new key</h2>
      <p>Only if the key may have leaked. The old key stops at once &mdash; paste the new one in the ERP straight away.</p>
      <form method="post" onsubmit="return confirm('Make a new key? The old one stops working at once.');">
        <?php wp_nonce_field('cz_erp_new_key'); ?>
        <button type="submit" name="cz_erp_new" value="1" class="button">Make a new key</button>
      </form>
    </div>
    <?php
}
