import { supabase } from './supabase-config.js';
import { toast } from './utils.js';

const COLLECTION_NAME = 'items';

function normalizeItem(item) {
    const createdAt = item.created_at || item.createdAt || new Date().toISOString();
    return {
        ...item,
        id: item.id,
        createdAt: createdAt && createdAt.toDate ? createdAt : { seconds: new Date(createdAt).getTime() / 1000 }
    };
}

export function subscribeToItems(callback, onError = null) {
    if (!supabase) {
        callback([]);
        if (onError) onError(new Error('Supabase client not initialized.'));
        return () => {};
    }

    const loadItems = async () => {
        try {
            const { data, error } = await supabase
                .from(COLLECTION_NAME)
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                throw error;
            }

            callback((data || []).map(normalizeItem));
        } catch (error) {
            console.error('Error loading items from Supabase:', error);
            callback([]);
            if (onError) onError(error);
        }
    };

    loadItems();

    try {
        const channel = supabase
            .channel('items_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: COLLECTION_NAME }, () => {
                loadItems();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    } catch (error) {
        console.error('Supabase realtime channel subscription failed:', error);
        return () => {};
    }
}

// upload item image to Supabase storage if configured
export async function uploadItemImage(file) {
    if (!file) return '';

    try {
        if (!supabase || !supabase.storage) {
            throw new Error('Supabase storage is not configured');
        }

        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
        const { data, error } = await supabase.storage.from('item-images').upload(fileName, file);

        if (error) throw error;
        const { data: publicUrlData } = supabase.storage.from('item-images').getPublicUrl(data.path);
        return publicUrlData?.publicUrl || '';
    } catch (error) {
        console.error('Image upload failed:', error);
        toast('Image upload failed. Please try again.', 'error');
        return '';
    }
}

// Submit new report
export async function submitItemReport(payload) {
    if (!supabase) {
        throw new Error('Supabase is not initialized');
    }

    const itemToInsert = {
        ...payload,
        created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from(COLLECTION_NAME)
        .insert(itemToInsert)
        .select();

    if (error) {
        throw error;
    }

    return normalizeItem((data && data[0]) || itemToInsert);
}

// Update existing report item status
export async function updateItemStatus(id, status) {
    if (!supabase) return false;

    const { error } = await supabase
        .from(COLLECTION_NAME)
        .update({ status })
        .eq('id', id);

    return !error;
}

// Delete a report item
export async function deleteItemReport(id) {
    if (!supabase) return false;

    const { error } = await supabase
        .from(COLLECTION_NAME)
        .delete()
        .eq('id', id);

    return !error;
}
