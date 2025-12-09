<?php
// Test file to check if .htaccess is working
// Upload this to your server and access it via: https://pos.istanbulsofra.pk/test-htaccess.php

echo "<h1>.htaccess Test Results</h1>";

// Check if mod_rewrite is enabled
if (function_exists('apache_get_modules')) {
    $modules = apache_get_modules();
    if (in_array('mod_rewrite', $modules)) {
        echo "<p style='color: green;'>✓ mod_rewrite is ENABLED</p>";
    } else {
        echo "<p style='color: red;'>✗ mod_rewrite is DISABLED</p>";
    }
} else {
    echo "<p style='color: orange;'>⚠ Cannot detect mod_rewrite status (function not available)</p>";
}

// Check if .htaccess exists
if (file_exists('.htaccess')) {
    echo "<p style='color: green;'>✓ .htaccess file EXISTS</p>";
    echo "<pre>" . htmlspecialchars(file_get_contents('.htaccess')) . "</pre>";
} else {
    echo "<p style='color: red;'>✗ .htaccess file NOT FOUND</p>";
}

// Server info
echo "<h2>Server Information</h2>";
echo "<p>Server Software: " . $_SERVER['SERVER_SOFTWARE'] . "</p>";
echo "<p>PHP Version: " . phpversion() . "</p>";

// Check AllowOverride
echo "<h2>Instructions</h2>";
echo "<p>If mod_rewrite is disabled or .htaccess isn't working:</p>";
echo "<ul>";
echo "<li>Contact your hosting provider to enable mod_rewrite</li>";
echo "<li>Ask them to set 'AllowOverride All' for your directory</li>";
echo "<li>OR ask for their recommended way to handle React Router URLs</li>";
echo "</ul>";
?>
